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
   * @throws {@link UserOpRevertError} if the chain rejects the op, or {@link AaFetchError} on a channel failure.
   */
  submitUserOp(userOp: PackedUserOperation, entryPoint: string): Promise<string>;

  /**
   * Query the current status of a submitted UserOperation.
   *
   * @param userOpHash - The hash returned by {@link submitUserOp}.
   * @returns The current {@link UserOpStatus}.
   * @throws {@link AaFetchError} on a transport or HTTP failure.
   */
  getStatus(userOpHash: string): Promise<UserOpStatus>;

  /**
   * Retrieve the execution receipt for a finalized UserOperation.
   *
   * @param userOpHash - The hash returned by {@link submitUserOp}.
   * @returns The {@link UserOpReceipt}, or `null` if the operation is not yet finalized.
   * @throws {@link AaFetchError} on a transport or HTTP failure.
   */
  getReceipt(userOpHash: string): Promise<UserOpReceipt | null>;
}
