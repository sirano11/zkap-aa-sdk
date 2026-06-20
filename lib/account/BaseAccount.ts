import { ethers } from "ethers";
import { PackedUserOperation } from "../types/UserOperation";
import { AaOperationError, AaOperationErrorCode } from "../errors";

/**
 * Abstract base class for ERC-4337 smart accounts.
 *
 * Provides the common account address, and declares the contract for signing,
 * submitting, and querying the nonce of a user operation. Concrete subclasses
 * (e.g. `ZkapAccount`) supply chain-specific implementations.
 *
 * @example
 * ```ts
 * class MyAccount extends BaseAccount {
 *   async signUserOpHash(hash: string) { ... }
 *   async sendTransaction(userOp: PackedUserOperation) { ... }
 *   async getNonce(nonceKey?: bigint) { ... }
 * }
 * const account = new MyAccount("0xYourAccountAddress");
 * console.log(account.getAddress());
 * ```
 */
export abstract class BaseAccount {
  /** The checksummed on-chain address of this smart account. */
  protected address: string;

  /**
   * @param address - The checksummed Ethereum address of the smart account.
   * @throws If `address` is not a valid Ethereum address.
   */
  constructor(address: string) {
    if (!ethers.isAddress(address)) {
      throw new AaOperationError({
        code: AaOperationErrorCode.INPUT_INVALID_ADDRESS,
        operation: "init_base_account",
        message: `Invalid account address: "${address}"`,
      });
    }
    this.address = address;
  }

  /**
   * Signs a UserOperation hash and returns the encoded signature(s).
   *
   * @param userOpHash - The 32-byte hex hash of the packed UserOperation.
   * @returns An array of ABI-encoded signature strings.
   */
  abstract signUserOpHash(userOpHash: string): Promise<string[]>;

  /**
   * Submits a fully-built `PackedUserOperation` to the bundler and returns the transaction hash.
   *
   * @param userOp - The packed and signed UserOperation ready for submission.
   * @returns The transaction hash of the submitted operation.
   */
  abstract sendTransaction(userOp: PackedUserOperation): Promise<string>;

  /**
   * Retrieves the current nonce for this account from the EntryPoint contract.
   *
   * @param nonceKey - Optional nonce key for parallel nonce sequences (defaults to `0n`).
   * @returns The current nonce value as a `bigint`.
   */
  abstract getNonce(nonceKey?: bigint): Promise<bigint>;

  /**
   * Returns the on-chain address of this smart account.
   *
   * @returns The checksummed Ethereum address string.
   */
  getAddress(): string {
    return this.address;
  }
}
