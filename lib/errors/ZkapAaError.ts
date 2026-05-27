import type { OperationType, ZkapAaCode } from "./codes";

/**
 * A contract custom error decoded via the SDK ABIs
 * (EntryPoint + ZkapAccount + ZkapPaymaster). Standard `Error(string)` /
 * `Panic(uint256)` are decoded by ethers as well and land here.
 */
export interface DecodedContractError {
  /** Custom error name (e.g. "InsufficientTxKeyWeight", "Error", "Panic"). */
  name: string;
  /** Error arguments. Empty array for errors with no args. */
  args: unknown[];
}

/**
 * Shared revert payload. Used by `UserOpRevertError` (validation/estimate throw)
 * and by `UserOpReceipt` (execution-revert result).
 */
export interface RevertInfo {
  /** Present when decoded. Undefined for selectors the SDK does not know. */
  contractError?: DecodedContractError;
  /** 4-byte selector (`0x` + 8 hex). Useful for matching/grouping even when undecoded. */
  selector?: string;
  /** Raw revert bytes. The consumer can decode with their own target ABI. */
  rawRevertData?: string;
}

export interface ZkapAaErrorOptions {
  /** Narrowed by subclasses (AaCode / ZkapAaFetchErrorCode / ...). */
  code: ZkapAaCode;
  /** Throw-site function name (snake_case). Closed OPERATIONS catalog. */
  operation: OperationType;
  message?: string;
  cause?: unknown;
}

/**
 * Abstract base class for all zkap-aa-sdk errors. Every library-thrown error
 * extends this class — consumers identify library origin with
 * `e instanceof ZkapAaError`.
 *
 * Abstract — direct instantiation forbidden. Use `UserOpRevertError`,
 * `AaFetchError`, or `AaOperationError`. Structure aligned with
 * `zkap-bank/src/errors/ZkapBankError.ts`.
 */
export abstract class ZkapAaError extends Error {
  readonly code: ZkapAaCode;
  readonly operation: OperationType;
  /** ES2022 Error.cause. Set as an own property in the constructor (declare for es2020 lib typing). */
  declare readonly cause?: unknown;
  /**
   * Throw time as an ISO 8601 UTC string (`2026-05-22T14:30:45.123Z`).
   * Auto-populated in the constructor. This is the library-throw moment, not the
   * Crashlytics upload moment (which can be delayed).
   */
  readonly timestamp: string;

  constructor(opts: ZkapAaErrorOptions) {
    super(opts.message ?? opts.code);
    this.name = new.target.name; // subclass name (e.g. "UserOpRevertError")
    this.code = opts.code;
    this.operation = opts.operation;
    this.timestamp = new Date().toISOString();
    // ES2022 Error.cause: not in the es2020 lib typings and not reliably passed
    // via the 2-arg constructor on older runtimes (RN Hermes). Set as a
    // non-enumerable own property (excluded from JSON.stringify).
    if (opts.cause !== undefined) {
      Object.defineProperty(this, "cause", { value: opts.cause, writable: true, configurable: true });
    }
  }
}
