import {
  ZkapAaError,
  UserOpRevertError,
  AaFetchError,
  AaOperationError,
  AaCode,
  AaFetchErrorCode,
  AaOperationErrorCode,
  OPERATIONS,
  AA_CODES,
  ZKAP_AA_FETCH_CODES,
  ZKAP_AA_OP_CODES,
  wrapAsOperationUnknown,
  wrapAsFetchUnknown,
  wrapAsUserOpRevertUnknown,
} from "../index";
import { safeStringify } from "../../utils/safeStringify";

describe("AaOperationError (representative base behavior)", () => {
  it("populates fields, name, timestamp, and inheritance", () => {
    const e = new AaOperationError({
      code: AaOperationErrorCode.INPUT_INVALID_ADDRESS,
      operation: "set_sender",
      message: "invalid Ethereum address",
    });
    expect(e).toBeInstanceOf(ZkapAaError);
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe("AaOperationError");
    expect(e.code).toBe("ZKAP_AA_OP_INPUT_INVALID_ADDRESS");
    expect(e.operation).toBe("set_sender");
    expect(e.message).toBe("invalid Ethereum address");
    expect(e.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/); // ISO 8601 UTC
  });

  it("falls back to code when message is omitted", () => {
    const e = new AaOperationError({ code: AaOperationErrorCode.UNKNOWN, operation: "init" });
    expect(e.message).toBe("ZKAP_AA_OP_UNKNOWN");
  });

  it("preserves cause but keeps it non-enumerable (excluded from JSON.stringify)", () => {
    const cause = new TypeError("boom");
    const e = new AaOperationError({ code: AaOperationErrorCode.INPUT_INVALID, operation: "init", cause });
    expect(e.cause).toBe(cause);
    expect(Object.keys(e)).not.toContain("cause");
  });
});

describe("JSON-safe serialization", () => {
  it("JSON.stringify does not throw and includes the core fields", () => {
    const e = new AaFetchError({
      code: AaFetchErrorCode.HTTP_STATUS,
      operation: "request_paymaster_data",
      service: "paymaster",
      url: "https://pm.example/sponsor",
      method: "POST",
      httpStatus: 500,
      rawResponse: '{"err":"down"}',
    });
    const json = JSON.parse(JSON.stringify(e));
    expect(json.name).toBe("AaFetchError");
    expect(json.code).toBe("ZKAP_AA_FETCH_HTTP_STATUS");
    expect(json.operation).toBe("request_paymaster_data");
    expect(json.service).toBe("paymaster");
    expect(json.httpStatus).toBe(500);
    expect(typeof json.timestamp).toBe("string");
  });
});

describe("UserOpRevertError", () => {
  it("carries phase, contractError, rawRevertData, and rawBundlerError", () => {
    const e = new UserOpRevertError({
      code: AaCode.AA23_ACCOUNT_REVERTED,
      operation: "submit_user_op",
      phase: "account_validation",
      rawBundlerError: '{"code":-32500,"message":"AA23 reverted"}',
      contractError: { name: "InsufficientTxKeyWeight", args: [] },
      rawRevertData: "0x4f76860e",
    });
    expect(e).toBeInstanceOf(ZkapAaError);
    expect(e.code).toBe("AA23_ACCOUNT_REVERTED");
    expect(e.phase).toBe("account_validation");
    expect(e.contractError).toEqual({ name: "InsufficientTxKeyWeight", args: [] });
    expect(e.rawRevertData).toBe("0x4f76860e");
    expect(e.rawBundlerError).toContain("AA23");
  });

  it("leaves contractError/rawRevertData undefined when no data is available", () => {
    const e = new UserOpRevertError({
      code: AaCode.AA21_INSUFFICIENT_PREFUND,
      operation: "submit_user_op",
      phase: "account_validation",
      rawBundlerError: "AA21 didn't pay prefund",
    });
    expect(e.contractError).toBeUndefined();
    expect(e.rawRevertData).toBeUndefined();
  });
});

describe("instanceof domain discrimination", () => {
  it("matches the base sentinel but not sibling classes", () => {
    const rev = new UserOpRevertError({ code: AaCode.UNKNOWN, operation: "submit_user_op", phase: "unknown", rawBundlerError: "x" });
    expect(rev).toBeInstanceOf(ZkapAaError);
    expect(rev).toBeInstanceOf(UserOpRevertError);
    expect(rev).not.toBeInstanceOf(AaFetchError);
    expect(rev).not.toBeInstanceOf(AaOperationError);
  });
});

describe("factories (*_UNKNOWN)", () => {
  it("wrapAsOperationUnknown", () => {
    const e = wrapAsOperationUnknown({ operation: "init", message: "weird" });
    expect(e).toBeInstanceOf(AaOperationError);
    expect(e.code).toBe("ZKAP_AA_OP_UNKNOWN");
  });
  it("wrapAsFetchUnknown", () => {
    const e = wrapAsFetchUnknown({ operation: "rpc_call", service: "bundler", url: "u", method: "POST" });
    expect(e.code).toBe("ZKAP_AA_FETCH_UNKNOWN");
    expect(e.service).toBe("bundler");
  });
  it("wrapAsUserOpRevertUnknown defaults phase to 'unknown'", () => {
    const e = wrapAsUserOpRevertUnknown({ operation: "submit_user_op", rawBundlerError: "raw" });
    expect(e.code).toBe("AA_UNKNOWN");
    expect(e.phase).toBe("unknown");
  });
});

describe("catalog integrity", () => {
  it("array view lengths", () => {
    expect(AA_CODES).toHaveLength(25);
    expect(ZKAP_AA_FETCH_CODES).toHaveLength(5);
    expect(ZKAP_AA_OP_CODES).toHaveLength(39);
  });
  it("code values are unique", () => {
    expect(new Set(ZKAP_AA_OP_CODES).size).toBe(ZKAP_AA_OP_CODES.length);
    expect(new Set(AA_CODES).size).toBe(AA_CODES.length);
  });
  it("OPERATIONS is a closed catalog with name normalization applied", () => {
    expect(OPERATIONS).toContain("init"); // constructor normalized
    expect(OPERATIONS).toContain("do_init"); // private "_" prefix stripped
    expect(OPERATIONS).toContain("estimate_user_op_gas");
    expect(new Set(OPERATIONS).size).toBe(OPERATIONS.length); // no collisions
  });
});

describe("safeStringify", () => {
  it("serializes a normal object to JSON", () => {
    expect(safeStringify({ a: 1 })).toBe('{"a":1}');
  });
  it("passes through strings unchanged", () => {
    expect(safeStringify("hello")).toBe("hello");
  });
  it("falls back to a string for circular refs without throwing", () => {
    const o: Record<string, unknown> = {};
    o.self = o;
    expect(typeof safeStringify(o)).toBe("string");
  });
  it("falls back for BigInt without throwing", () => {
    expect(typeof safeStringify({ n: 10n })).toBe("string");
  });
});
