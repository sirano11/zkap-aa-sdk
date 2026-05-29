import { ethers } from "ethers";

import { EntryPointABI, ZkapAccountABI, ZkapPaymasterABI } from "../../types/abi";
import { AaCode, AaFetchError, AaOperationError, UserOpRevertError, aaCodeToPhase, mapAaPrefix } from "../../errors";
import { decodeContractError } from "../revertDecoder";
import { classifyBundlerError, makeFetchTransportError } from "../bundlerErrorWrapper";

// Fixtures encoded from the shipped ABIs use real selectors (keccak(sig)[:4]),
// identical to deployed bytecode. The two literal selectors below are captured
// from real Base Sepolia receipts.
const errIface = new ethers.Interface(
  [...EntryPointABI, ...ZkapAccountABI, ...ZkapPaymasterABI].filter((f: { type?: string }) => f.type === "error"),
);

describe("mapAaPrefix", () => {
  it("maps a known AA prefix to its AaCode", () => {
    expect(mapAaPrefix("AA21 didn't pay prefund")).toBe(AaCode.AA21_INSUFFICIENT_PREFUND);
    expect(mapAaPrefix("AA25 invalid account nonce")).toBe(AaCode.AA25_INVALID_NONCE);
  });
  it("matches case-insensitively and when embedded", () => {
    expect(mapAaPrefix("FailedOp at index 0: aa23 reverted")).toBe(AaCode.AA23_ACCOUNT_REVERTED);
  });
  it("returns undefined when there is no AA prefix", () => {
    expect(mapAaPrefix("replacement underpriced")).toBeUndefined();
  });
  it("maps an off-catalog AA prefix to AA_UNKNOWN", () => {
    expect(mapAaPrefix("AA99 something new")).toBe(AaCode.UNKNOWN);
  });

  // Exhaustive: every catalogued AA prefix → its AaCode. This is the unit-level
  // replacement for the old provider-driven classification matrix.
  it.each([
    ["AA10", AaCode.AA10_SENDER_ALREADY_CONSTRUCTED],
    ["AA13", AaCode.AA13_INIT_CODE_FAILED],
    ["AA14", AaCode.AA14_INIT_CODE_MUST_RETURN_SENDER],
    ["AA15", AaCode.AA15_INIT_CODE_MUST_CREATE_SENDER],
    ["AA20", AaCode.AA20_NOT_DEPLOYED],
    ["AA21", AaCode.AA21_INSUFFICIENT_PREFUND],
    ["AA22", AaCode.AA22_EXPIRED_OR_NOT_DUE],
    ["AA23", AaCode.AA23_ACCOUNT_REVERTED],
    ["AA24", AaCode.AA24_SIGNATURE_ERROR],
    ["AA25", AaCode.AA25_INVALID_NONCE],
    ["AA31", AaCode.AA31_PAYMASTER_DEPOSIT_TOO_LOW],
    ["AA32", AaCode.AA32_PAYMASTER_EXPIRED_OR_NOT_DUE],
    ["AA33", AaCode.AA33_PAYMASTER_REVERTED],
    ["AA34", AaCode.AA34_PAYMASTER_SIGNATURE_ERROR],
    ["AA40", AaCode.AA40_OVER_VERIFICATION_GAS_LIMIT],
    ["AA41", AaCode.AA41_UNDER_VERIFICATION_GAS],
    ["AA50", AaCode.AA50_POST_OP_REVERTED],
    ["AA51", AaCode.AA51_PREFUND_BELOW_GAS_COST],
    ["AA90", AaCode.AA90_INVALID_BENEFICIARY],
    ["AA91", AaCode.AA91_FAILED_SEND_TO_BENEFICIARY],
    ["AA92", AaCode.AA92_INTERNAL_CALL_ONLY],
    ["AA93", AaCode.AA93_INVALID_PAYMASTER_AND_DATA],
    ["AA94", AaCode.AA94_GAS_VALUES_OVERFLOW],
    ["AA95", AaCode.AA95_OUT_OF_GAS],
  ] as const)("maps %s to its AaCode", (prefix, code) => {
    expect(mapAaPrefix(`${prefix} reverted`)).toBe(code);
  });
});

describe("aaCodeToPhase", () => {
  it("derives the lifecycle phase", () => {
    expect(aaCodeToPhase(AaCode.AA21_INSUFFICIENT_PREFUND)).toBe("account_validation");
    expect(aaCodeToPhase(AaCode.AA31_PAYMASTER_DEPOSIT_TOO_LOW)).toBe("paymaster_validation");
    expect(aaCodeToPhase(AaCode.AA13_INIT_CODE_FAILED)).toBe("factory");
    expect(aaCodeToPhase(AaCode.AA50_POST_OP_REVERTED)).toBe("post_op");
    expect(aaCodeToPhase(AaCode.UNKNOWN)).toBe("unknown");
    // AA94 gas-field overflow precheck gates account validation (_validatePrepayment).
    expect(aaCodeToPhase(AaCode.AA94_GAS_VALUES_OVERFLOW)).toBe("account_validation");
    // AA93 paymasterAndData parsing belongs to the paymaster validation path.
    expect(aaCodeToPhase(AaCode.AA93_INVALID_PAYMASTER_AND_DATA)).toBe("paymaster_validation");
    // AA92 internal-call guard and AA95 out-of-gas both fire on the execution path.
    expect(aaCodeToPhase(AaCode.AA92_INTERNAL_CALL_ONLY)).toBe("execution");
    expect(aaCodeToPhase(AaCode.AA95_OUT_OF_GAS)).toBe("execution");
    // AA90/91 fire in _compensate — per-batch beneficiary settlement, not postOp.
    expect(aaCodeToPhase(AaCode.AA90_INVALID_BENEFICIARY)).toBe("settlement");
    expect(aaCodeToPhase(AaCode.AA91_FAILED_SEND_TO_BENEFICIARY)).toBe("settlement");
  });
});

describe("decodeContractError", () => {
  it("unwraps FailedOpWithRevert one level to the inner custom error", () => {
    const inner = errIface.encodeErrorResult("InsufficientTxKeyWeight", []);
    const wrapped = errIface.encodeErrorResult("FailedOpWithRevert", [0n, "AA23 reverted (or OOG)", inner]);
    expect(decodeContractError(wrapped).contractError).toEqual({ name: "InsufficientTxKeyWeight", args: [] });
  });
  it("decodes the standard Error(string) (matches the real ERC20 receipt)", () => {
    const data = errIface.encodeErrorResult("Error", ["ERC20: transfer amount exceeds balance"]);
    expect(decodeContractError(data).contractError).toEqual({ name: "Error", args: ["ERC20: transfer amount exceeds balance"] });
  });
  it("decodes Panic(uint256)", () => {
    const data = errIface.encodeErrorResult("Panic", [0x11]);
    expect(decodeContractError(data).contractError).toEqual({ name: "Panic", args: ["17"] });
  });
  it("decodes a real captured OZ FailedCall selector", () => {
    // 0xd6bda275 — from real Base Sepolia receipt 0xc9f0502c...
    expect(decodeContractError("0xd6bda275").contractError).toEqual({ name: "FailedCall", args: [] });
  });
  it("preserves selector + raw (no contractError) for unknown target selectors", () => {
    // 0x1b16c2b3 / 0xe6e287bf — unknown target errors from real receipts.
    const a = decodeContractError("0x1b16c2b3" + "00".repeat(32));
    expect(a.contractError).toBeUndefined();
    expect(a.selector).toBe("0x1b16c2b3");
    expect(a.rawRevertData).toBe("0x1b16c2b3" + "00".repeat(32));
    expect(decodeContractError("0xe6e287bf" + "00".repeat(32)).contractError).toBeUndefined();
  });
  it("throws AaOperationError on empty / non-hex / selector-less input", () => {
    expect(() => decodeContractError("0x")).toThrow(AaOperationError);
    expect(() => decodeContractError("")).toThrow(AaOperationError);
    expect(() => decodeContractError("not hex")).toThrow(AaOperationError);
    expect(() => decodeContractError("0xab")).toThrow(AaOperationError); // shorter than a 4-byte selector
  });
});

describe("classifyBundlerError (3-way)", () => {
  const ctx = { operation: "submit_user_op" as const, service: "bundler" as const, url: "https://b", method: "POST" as const };

  it("AA prefix in message → UserOpRevertError (validation)", () => {
    const e = classifyBundlerError({ ...ctx, text: "AA21 didn't pay prefund", raw: '{"message":"AA21 ..."}' });
    expect(e).toBeInstanceOf(UserOpRevertError);
    const r = e as UserOpRevertError;
    expect(r.code).toBe(AaCode.AA21_INSUFFICIENT_PREFUND);
    expect(r.phase).toBe("account_validation");
    expect(r.rawBundlerError).toContain("AA21");
  });

  it("no AA but revert data → UserOpRevertError (execution)", () => {
    const data = errIface.encodeErrorResult("Error", ["ERC20: transfer amount exceeds balance"]);
    const e = classifyBundlerError({ ...ctx, text: "execution reverted", data, raw: "raw" });
    expect(e).toBeInstanceOf(UserOpRevertError);
    const r = e as UserOpRevertError;
    expect(r.code).toBe(AaCode.UNKNOWN);
    expect(r.phase).toBe("execution");
    expect(r.contractError).toEqual({ name: "Error", args: ["ERC20: transfer amount exceeds balance"] });
  });

  it("HTTP status, no revert → AaFetchError (channel)", () => {
    const e = classifyBundlerError({ ...ctx, text: "Bad Gateway", httpStatus: 502, raw: "<html>502</html>" });
    expect(e).toBeInstanceOf(AaFetchError);
    const f = e as AaFetchError;
    expect(f.code).toBe("ZKAP_AA_FETCH_HTTP_STATUS");
    expect(f.httpStatus).toBe(502);
    expect(f.rawResponse).toContain("502");
  });
});

describe("makeFetchTransportError", () => {
  it("classifies AbortError as TIMEOUT, else TRANSPORT", () => {
    const ctx = { service: "bundler" as const, url: "u", method: "POST" as const, operation: "rpc_call" as const };
    const abort = new DOMException("aborted", "AbortError");
    expect(makeFetchTransportError(abort, ctx).code).toBe("ZKAP_AA_FETCH_TIMEOUT");
    expect(makeFetchTransportError(new TypeError("network"), ctx).code).toBe("ZKAP_AA_FETCH_TRANSPORT");
  });
});
