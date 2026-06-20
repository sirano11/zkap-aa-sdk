import { ZkapBuilder } from "./ZkapBuilder";
import { ZkapFactoryBuilder } from "./ZkapFactoryBuilder";
import { ethers } from "ethers";

/**
 * Initialization parameters required to create a new ZKAP smart account.
 */
export interface ZkapCreatorInfo {
  /** The EVM chain ID where the account will be deployed. */
  chainId: number;
  /** The ERC-4337 EntryPoint contract address. */
  entryPoint: string;
  /** The ZkapAccountFactory contract address used to deploy the account. */
  zkapFactory: string;
  /** JSON-RPC endpoint URL for the target network. */
  enUrl: string;
  /** A unique salt value that determines the counterfactual account address. */
  salt: string;
  /** ABI-encoded master key used for account ownership. */
  encodedMasterKey: string;
  /** ABI-encoded transaction key used for signing operations. */
  encodedTxKey: string;
  /**
   * Upper bound for `gasLimit` in internal `eth_estimateGas` calls.
   * Defaults to 15M. Set `0n` to disable injection (escape hatch for chains
   * with conflicting gas semantics). See {@link ZkapAccountInfo.rpcEstimateGasCap}.
   */
  rpcEstimateGasCap?: bigint;
}

/**
 * Handles the creation and address derivation of a new ZKAP smart account.
 *
 * `ZkapCreator` extends {@link ZkapBuilder} and sets the ERC-4337 `initCode`
 * so that a new account is deployed on the first UserOperation. The
 * counterfactual address can be resolved before deployment via
 * {@link deriveZkapAddress}.
 *
 * @example
 * ```ts
 * const creator = new ZkapCreator({
 *   chainId: 1,
 *   entryPoint: "0x...",
 *   zkapFactory: "0x...",
 *   enUrl: "https://rpc.example.com",
 *   salt: "0x0000...0001",
 *   encodedMasterKey: "0x...",
 *   encodedTxKey: "0x...",
 * });
 *
 * const address = await creator.deriveZkapAddress();
 * ```
 */
export class ZkapCreator extends ZkapBuilder {
  private zkapFactory: string;
  private salt: string;
  private encodedMasterKey: string;
  private encodedTxKey: string;
  private address: string = ethers.ZeroAddress;
  private _derivePromise: Promise<string> | null = null;

  /**
   * Creates a new `ZkapCreator` instance and configures the `initCode` for
   * counterfactual account deployment.
   *
   * @param params - Account creation parameters. See {@link ZkapCreatorInfo}.
   */
  constructor({
    chainId,
    entryPoint,
    zkapFactory,
    enUrl,
    salt,
    encodedMasterKey,
    encodedTxKey,
    rpcEstimateGasCap,
  }: ZkapCreatorInfo) {
    super({
      chainId,
      entryPoint,
      enUrl,
      rpcEstimateGasCap,
    });
    this.setInitCode(zkapFactory, salt, { encodedMasterKey, encodedTxKey });
    this.zkapFactory = zkapFactory;
    this.salt = salt;
    this.encodedMasterKey = encodedMasterKey;
    this.encodedTxKey = encodedTxKey;
  }

  /**
   * Resolves and caches the counterfactual address of the ZKAP smart account.
   *
   * The result is derived by calling `calcAccountAddress` on the factory
   * contract. Subsequent calls return the cached address without a network
   * round-trip. If the request fails the cache is cleared so the call can be
   * retried.
   *
   * @returns The checksummed Ethereum address of the (not-yet-deployed) account.
   * @throws If the factory contract call fails or the RPC endpoint is unreachable.
   *
   * @example
   * ```ts
   * const address = await creator.deriveZkapAddress();
   * console.log("Account address:", address);
   * ```
   */
  async deriveZkapAddress(): Promise<string> {
    if (this.address !== ethers.ZeroAddress) return this.address;
    if (!this._derivePromise) {
      this._derivePromise = (async () => {
        const zkapFactory = new ZkapFactoryBuilder(this.zkapFactory, this.enUrl);
        const zkapAddress = await zkapFactory.calcAccountAddress(
          this.salt,
          this.encodedMasterKey,
          this.encodedTxKey
        );
        this.address = zkapAddress;
        this.setSender(zkapAddress);
        return zkapAddress;
      })().catch((err) => {
        this._derivePromise = null; // Reset on failure to allow retry
        throw err;
      });
    }
    return this._derivePromise;
  }

}
