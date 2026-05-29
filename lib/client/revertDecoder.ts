import { ethers } from "ethers";

import { EntryPointABI, ZkapAccountABI, ZkapPaymasterABI } from "../types/abi";
import { AaOperationError, AaOperationErrorCode, type RevertInfo } from "../errors";

/**
 * Decodes revert bytes into a contract custom-error name + args.
 *
 * Combines the error fragments the SDK ships (EntryPoint + ZkapAccount +
 * ZkapPaymaster). ethers adds the standard `Error(string)` / `Panic(uint256)`
 * fragments automatically, so those decode too. Selectors are deterministic
 * (`keccak(signature)[:4]`), so this matches the deployed bytecode.
 *
 * Verified against real Base Sepolia receipts: `Error("ERC20: transfer amount
 * exceeds balance")`, OZ `FailedCall`, and unknown target selectors (→ raw bytes +
 * selector preserved, no `contractError`).
 */
const errorInterface = new ethers.Interface(
  [...EntryPointABI, ...ZkapAccountABI, ...ZkapPaymasterABI].filter(
    (f: { type?: string }) => f.type === "error",
  ),
);

/**
 * Make decoded error args JSON-safe. ethers returns `bigint` for uint args, which
 * would make `JSON.stringify(error)` throw — so BigInts (and nested objects) are
 * stringified. JSON-safe primitives are kept as-is.
 */
function jsonSafeArgs(args: ReadonlyArray<unknown>): unknown[] {
  return args.map((a) => {
    if (typeof a === "bigint") return a.toString();
    if (typeof a === "object" && a !== null) return String(a);
    return a;
  });
}

/**
 * Decodes revert bytes into a {@link RevertInfo}. Always preserves the 4-byte
 * selector + raw bytes; a known selector additionally carries the decoded
 * `contractError`. An unknown selector returns selector + raw only (no
 * `contractError`) so the consumer can decode with their own target ABI (facts-only).
 *
 * `data` must be a hex string with at least a 4-byte selector — anything else
 * (empty, `"0x"`, non-hex) is a caller error and throws `AaOperationError`. Callers
 * holding untrusted input should gate with `ethers.isHexString` first.
 *
 * Unwraps EntryPoint `FailedOpWithRevert(opIndex, reason, inner)` one level to
 * recover the actual contract error carried in `inner`.
 */
export function decodeContractError(data: string): RevertInfo {
  if (!ethers.isHexString(data) || data.length < 10) {
    throw new AaOperationError({
      code: AaOperationErrorCode.INPUT_INVALID_FORMAT,
      operation: "decode",
      message: "decodeContractError requires hex revert data with at least a 4-byte selector",
    });
  }
  const selector = data.slice(0, 10);
  let outer: ethers.ErrorDescription | null;
  try {
    outer = errorInterface.parseError(data);
  } catch {
    return { selector, rawRevertData: data }; // unknown selector
  }
  if (!outer) return { selector, rawRevertData: data };
  if (outer.name === "FailedOpWithRevert") {
    const inner = outer.args[2] as string;
    try {
      const decodedInner = errorInterface.parseError(inner);
      if (decodedInner) {
        return {
          contractError: { name: decodedInner.name, args: jsonSafeArgs(decodedInner.args) },
          selector,
          rawRevertData: data,
        };
      }
    } catch {
      // inner not decodable — fall through to the outer (FailedOpWithRevert)
    }
  }
  return {
    contractError: { name: outer.name, args: jsonSafeArgs(outer.args) },
    selector,
    rawRevertData: data,
  };
}
