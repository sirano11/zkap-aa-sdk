import type { PackedUserOperation } from "../types/UserOperation";
import type { DecodedContractError } from "../errors";

export type { PackedUserOperation };

/**
 * Lifecycle status of a submitted UserOperation as reported by the bundler.
 *
 * - `"pending"` — the UserOp has been submitted but not yet included in a block.
 * - `"included"` — the UserOp was successfully included in a block.
 * - `"failed"` — the UserOp was rejected or reverted.
 * - `"not_found"` — the bundler has no record of the UserOp hash.
 */
export type UserOpStatus =
  | "pending"
  | "included"
  | "failed"
  | "not_found";

/**
 * On-chain execution receipt for a UserOperation.
 */
export interface UserOpReceipt {
  /** The keccak256 hash of the UserOperation. */
  userOpHash: string;
  /** Hash of the bundle transaction that included this UserOp. */
  txHash: string;
  /** Block number in which the UserOp was included. */
  blockNumber: number;
  /** Whether the UserOp execution succeeded (`true`) or reverted (`false`). */
  success: boolean;
  /** Total gas cost paid by the account or paymaster, in wei (as a decimal string). */
  actualGasCost: string;
  /** Actual gas units consumed during execution (as a decimal string). */
  actualGasUsed: string;
  /**
   * Raw execution-revert reason, present only when `success` is `false`. Extracted
   * from the EntryPoint `UserOperationRevertReason` log (hex bytes) or a bundler's
   * top-level reason. Unlike a validation rejection (thrown as `UserOpRevertError`),
   * an execution revert is mined on-chain and surfaced here, not thrown.
   */
  revertReason?: string;
  /**
   * The decoded contract custom error, best-effort, when `revertReason` decodes
   * against the SDK ABIs (EntryPoint / ZkapAccount / ZkapPaymaster) or standard
   * `Error(string)` / `Panic`. Undefined for selectors the SDK does not know.
   */
  contractError?: DecodedContractError;
  /** 4-byte selector of the revert, preserved even when the error is not decodable. */
  revertSelector?: string;
}

/**
 * Transport abstraction for communicating with an ERC-4337 bundler.
 *
 * Implement this interface to support custom bundler backends.
 * Two built-in implementations are provided: {@link ZkapBundlerProvider} and
 * {@link Erc4337BundlerProvider}.
 */
export interface BundlerProvider {
  /**
   * Submit a packed UserOperation to the bundler mempool.
   *
   * @param userOp - The fully constructed and signed packed UserOperation.
   * @param entryPoint - Address of the ERC-4337 EntryPoint contract.
   * @returns The UserOperation hash assigned by the bundler.
   * @throws {@link BundlerError} if the bundler rejects the operation or a network error occurs.
   */
  submitUserOp(userOp: PackedUserOperation, entryPoint: string): Promise<string>;

  /**
   * Query the current status of a submitted UserOperation.
   *
   * @param userOpHash - The hash returned by {@link submitUserOp}.
   * @returns The current {@link UserOpStatus}.
   * @throws {@link BundlerError} on network failure.
   */
  getStatus(userOpHash: string): Promise<UserOpStatus>;

  /**
   * Retrieve the execution receipt for a finalized UserOperation.
   *
   * @param userOpHash - The hash returned by {@link submitUserOp}.
   * @returns The {@link UserOpReceipt}, or `null` if the operation is not yet finalized.
   * @throws {@link BundlerError} on network failure.
   */
  getReceipt(userOpHash: string): Promise<UserOpReceipt | null>;
}

/**
 * Machine-readable error codes surfaced by {@link BundlerError}.
 *
 * - `"AA21_INSUFFICIENT_FUNDS"` — account balance too low to cover gas (ERC-4337 AA21).
 * - `"AA25_NONCE_ERROR"` — UserOp nonce is invalid or already used (ERC-4337 AA25).
 * - `"AA40_PAYMASTER_ERROR"` — paymaster validation failed (ERC-4337 AA31/AA32/AA40/AA41).
 * - `"BUNDLER_TIMEOUT"` — confirmation was not received within the allotted time.
 * - `"BUNDLER_REJECTED"` — bundler rejected the UserOp for an unclassified reason.
 * - `"NETWORK_ERROR"` — a transient network or connectivity failure occurred.
 */
export type BundlerErrorCode =
  | "AA21_INSUFFICIENT_FUNDS"
  | "AA25_NONCE_ERROR"
  | "AA40_PAYMASTER_ERROR"
  | "BUNDLER_TIMEOUT"
  | "BUNDLER_REJECTED"
  | "NETWORK_ERROR";

/**
 * Structured error thrown by {@link BundlerClient} and {@link BundlerProvider} implementations.
 *
 * @example
 * ```ts
 * try {
 *   await client.submitUserOp(userOp, entryPoint);
 * } catch (err) {
 *   if (err instanceof BundlerError && err.retryable) {
 *     // safe to retry
 *   }
 * }
 * ```
 */
export class BundlerError extends Error {
  /** Machine-readable error classification. */
  code: BundlerErrorCode;
  /** Whether the operation may succeed if retried (e.g. transient network errors). */
  retryable: boolean;

  /**
   * @param message - Human-readable error description.
   * @param code - Machine-readable error code for programmatic handling.
   * @param retryable - Set to `true` for transient errors that may succeed on retry.
   */
  constructor(message: string, code: BundlerErrorCode, retryable = false) {
    super(message);
    this.name = "BundlerError";
    this.code = code;
    this.retryable = retryable;
  }
}
