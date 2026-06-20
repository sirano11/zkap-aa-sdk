import type { PackedUserOperation } from "../types/UserOperation";
import type { BundlerProvider, UserOpReceipt, UserOpStatus } from "./types";
import { AaFetchError, AaFetchErrorCode } from "../errors";

const DEFAULT_POLL_INTERVAL = 2000;
const DEFAULT_TIMEOUT = 60000;

/**
 * High-level client for submitting ERC-4337 UserOperations and tracking their
 * on-chain status via a {@link BundlerProvider}.
 *
 * @example
 * ```ts
 * const provider = new ZkapBundlerProvider();
 * const client = new BundlerClient(provider);
 *
 * const userOpHash = await client.submitUserOp(packedUserOp, entryPoint);
 * const receipt = await client.waitForReceipt(userOpHash);
 * console.log(receipt.success); // true
 * ```
 */
export class BundlerClient {
  private readonly provider: BundlerProvider;

  /**
   * @param provider - The bundler transport to use for all network calls.
   */
  constructor(provider: BundlerProvider) {
    this.provider = provider;
  }

  /**
   * Submit a packed UserOperation to the bundler mempool.
   *
   * @param userOp - The fully constructed and signed packed UserOperation.
   * @param entryPoint - Address of the ERC-4337 EntryPoint contract.
   * @returns The UserOperation hash assigned by the bundler.
   * @throws {@link UserOpRevertError} if the chain rejects the op, or {@link AaFetchError} on a channel failure.
   */
  async submitUserOp(userOp: PackedUserOperation, entryPoint: string): Promise<string> {
    return this.provider.submitUserOp(userOp, entryPoint);
  }

  /**
   * Query the current status of a submitted UserOperation.
   *
   * @param userOpHash - The hash returned by {@link submitUserOp}.
   * @returns The current {@link UserOpStatus}.
   * @throws {@link AaFetchError} on a transport or HTTP failure.
   */
  async getStatus(userOpHash: string): Promise<UserOpStatus> {
    return this.provider.getStatus(userOpHash);
  }

  /**
   * Poll the bundler until the UserOperation is finalized, then return its receipt.
   *
   * Polls at `pollInterval` ms intervals until the operation reaches `"included"` or
   * `"failed"` status, or until `timeout` ms elapse.
   *
   * @param userOpHash - The hash returned by {@link submitUserOp}.
   * @param options.pollInterval - Milliseconds between status polls (default: 2000).
   * @param options.timeout - Maximum milliseconds to wait before throwing (default: 60000).
   * @returns The {@link UserOpReceipt} once the operation is finalized.
   * @throws {@link AaFetchError} (code TIMEOUT) if the deadline is exceeded.
   *
   * @example
   * ```ts
   * const receipt = await client.waitForReceipt(userOpHash, {
   *   pollInterval: 1000,
   *   timeout: 30000,
   * });
   * ```
   */
  async waitForReceipt(
    userOpHash: string,
    options?: { pollInterval?: number; timeout?: number }
  ): Promise<UserOpReceipt> {
    const pollInterval = (options && options.pollInterval) ? options.pollInterval : DEFAULT_POLL_INTERVAL;
    const timeout = (options && options.timeout) ? options.timeout : DEFAULT_TIMEOUT;
    const deadline = Date.now() + timeout;

    while (Date.now() < deadline) {
      const status = await this.provider.getStatus(userOpHash);

      if (status === "included") {
        const receipt = await this.provider.getReceipt(userOpHash);
        return receipt ?? this._buildReceipt(userOpHash, true);
      }

      if (status === "failed") {
        const receipt = await this.provider.getReceipt(userOpHash);
        return receipt ?? this._buildReceipt(userOpHash, false);
      }

      // "pending" or "not_found" — keep polling
      await this._sleep(pollInterval);
    }

    throw new AaFetchError({
      code: AaFetchErrorCode.TIMEOUT,
      operation: "wait_for_receipt",
      service: "bundler",
      method: "GET",
      message: `UserOp ${userOpHash} not confirmed within ${timeout}ms`,
    });
  }

  private _buildReceipt(userOpHash: string, success: boolean): UserOpReceipt {
    return {
      userOpHash,
      txHash: "",
      blockNumber: 0,
      success,
      actualGasCost: "0",
      actualGasUsed: "0",
    };
  }

  private _sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
