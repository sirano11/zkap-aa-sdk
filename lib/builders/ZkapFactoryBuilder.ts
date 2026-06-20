import { ethers } from "ethers";
import { ZkapAccountFactoryABI } from "../types/abi";
import { AaOperationError, AaOperationErrorCode } from "../errors";

/**
 * Thin wrapper around the on-chain `ZkapAccountFactory` contract that exposes
 * read-only factory operations such as counterfactual address derivation.
 *
 * @example
 * ```ts
 * const factory = new ZkapFactoryBuilder("0xFactory...", "https://rpc.example.com");
 * const address = await factory.calcAccountAddress(salt, encodedMasterKey, encodedTxKey);
 * ```
 */
export class ZkapFactoryBuilder {
  private provider: ethers.JsonRpcProvider;
  private accountFactory: ethers.Contract;

  /**
   * Creates a `ZkapFactoryBuilder` connected to the given factory contract.
   *
   * @param address - Ethereum address of the deployed `ZkapAccountFactory` contract.
   * @param enUrl - JSON-RPC endpoint URL used to query the factory.
   * @throws If `address` is not a valid Ethereum address or `enUrl` is not a valid URL.
   */
  constructor(address: string, enUrl: string) {
    if (!ethers.isAddress(address)) {
      throw new AaOperationError({
        code: AaOperationErrorCode.INPUT_INVALID_ADDRESS,
        operation: "init_zkap_factory_builder",
        message: `ZkapFactoryBuilder: invalid contract address: "${address}"`,
      });
    }
    try {
      new URL(enUrl);
    } catch {
      throw new AaOperationError({
        code: AaOperationErrorCode.INPUT_INVALID_URL,
        operation: "init_zkap_factory_builder",
        message: `Invalid enUrl: "${enUrl}". Must be a valid URL.`,
      });
    }
    this.provider = new ethers.JsonRpcProvider(enUrl);
    this.accountFactory = new ethers.Contract(
      address,
      ZkapAccountFactoryABI,
      this.provider
    );
  }

  /**
   * Computes the counterfactual address of a ZKAP smart account without
   * deploying it, by calling `calcAccountAddress` on the factory contract.
   *
   * @param salt - Unique salt that differentiates accounts with the same keys.
   * @param encodedMasterKey - ABI-encoded master key for the account.
   * @param encodedTxKey - ABI-encoded transaction key for the account.
   * @returns The checksummed Ethereum address the account would be deployed at.
   * @throws If the RPC call fails or the contract reverts.
   *
   * @example
   * ```ts
   * const address = await factory.calcAccountAddress(
   *   "0x0000...0001",
   *   encodedMasterKey,
   *   encodedTxKey
   * );
   * ```
   */
  async calcAccountAddress(
    salt: string,
    encodedMasterKey: string,
    encodedTxKey: string
  ): Promise<string> {
    const address = await this.accountFactory.calcAccountAddress(
      salt,
      encodedMasterKey,
      encodedTxKey
    );
    return address;
  }
}
