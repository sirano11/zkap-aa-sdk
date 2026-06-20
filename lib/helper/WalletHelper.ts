import { ethers } from "ethers";
import type { ChainRegistry, ChainConfig } from "../registry/ChainRegistry";
import type { BundlerClient } from "../client/BundlerClient";
import { AccountReader } from "../reader/AccountReader";
import type { TxKeyInfo } from "../reader/AccountReader";
import { AaFetchError, AaFetchErrorCode } from "../errors";
import type { UserOpReceipt } from "../client/types";
import type { IUserOpSigner } from "../utils/IUserOpSigner";
import { ZkapBuilder } from "../builders/ZkapBuilder";
import { computeSalt } from "../utils/salt";

// Minimal ABI for ZkapFactory.getAddress()
const ZKAP_FACTORY_ABI = [
  "function getAddress(uint256 salt) view returns (address)",
  "function getAddress(uint256 salt, bytes encodedMasterKey, bytes encodedTxKey) view returns (address)",
];

export interface WalletHelperConfig {
  chainRegistry: ChainRegistry;
  bundlerClient: BundlerClient;
}

export class WalletHelper {
  private readonly chainRegistry: ChainRegistry;
  private readonly bundlerClient: BundlerClient;
  private readonly _readers: Map<number, AccountReader> = new Map();

  constructor(config: WalletHelperConfig) {
    this.chainRegistry = config.chainRegistry;
    this.bundlerClient = config.bundlerClient;
  }

  /**
   * Compute the deterministic wallet salt from social login identifiers.
   * keccak256(abi.encode(aud, sub)) — matches on-chain derivation.
   */
  static computeSalt(aud: string, sub: string): string {
    return computeSalt(aud, sub);
  }

  /**
   * Get or create an AccountReader for the given chain, cached by chainId.
   */
  private getAccountReader(chainConfig: ChainConfig): AccountReader {
    if (!this._readers.has(chainConfig.chainId)) {
      this._readers.set(
        chainConfig.chainId,
        new AccountReader({ rpcUrl: chainConfig.rpcUrl })
      );
    }
    return this._readers.get(chainConfig.chainId)!;
  }

  /**
   * Derive the counterfactual wallet address for a user.
   * Calls the factory's getAddress(salt) view function.
   *
   * @param params.aud     - OAuth audience / client_id (e.g. Google client ID)
   * @param params.sub     - User's subject identifier from the provider
   * @param params.chainId - Target chain ID
   */
  async deriveAddress(params: {
    aud: string;
    sub: string;
    chainId: number;
  }): Promise<string> {
    const { aud, sub, chainId } = params;
    const chainConfig = await this.chainRegistry.getChainConfig(chainId);

    const salt = computeSalt(aud, sub);
    const saltBigInt = BigInt(salt);

    const rpcProvider = new ethers.JsonRpcProvider(chainConfig.rpcUrl);
    const factory = new ethers.Contract(chainConfig.zkapFactory, ZKAP_FACTORY_ABI, rpcProvider);

    try {
      const address = await factory["getAddress(uint256)"](saltBigInt);
      return address as string;
    } catch (err) {
      throw new AaFetchError({
        code: AaFetchErrorCode.TRANSPORT,
        operation: "derive_address",
        service: "rpc",
        url: chainConfig.rpcUrl,
        method: "POST",
        cause: err,
        message: `WalletHelper.deriveAddress: failed to call getAddress on factory ${chainConfig.zkapFactory} for chainId ${chainId}: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  /**
   * Send a single transaction from a deployed ZKAP wallet.
   * Flow: ZkapBuilder.setSender → setExecuteCallData → autoFillUserOp → sign → submit
   *
   * Returns userOpHash immediately and a receipt promise that resolves on confirmation.
   */
  async sendTransaction(params: {
    sender: string;
    to: string;
    value: string;
    data?: string;
    signer: IUserOpSigner;
    chainId: number;
  }): Promise<{ userOpHash: string; receipt: Promise<UserOpReceipt> }> {
    const { sender, to, value, data, signer, chainId } = params;
    const chainConfig = await this.chainRegistry.getChainConfig(chainId);

    const builder = new ZkapBuilder({
      chainId,
      entryPoint: chainConfig.entryPoint,
      enUrl: chainConfig.rpcUrl,
    });

    builder
      .setSender(sender)
      .setExecuteCallData(to, value, data || "0x", signer.keyTypes);

    await builder.autoFillUserOp();

    const userOpHash = builder.getUserOpHash();
    const signatures = await signer.signUserOpHash(userOpHash);

    // Build keyIndexList: [0, 1, ...] matching keyTypes length
    const keyIndexList = signer.keyTypes.map((_, i) => i);
    builder.setSignature(keyIndexList, signatures);

    const packedUserOp = builder.getPackedUserOp();
    const submittedHash = await this.bundlerClient.submitUserOp(packedUserOp, chainConfig.entryPoint);

    const receipt = this.bundlerClient.waitForReceipt(submittedHash, undefined);
    return { userOpHash: submittedHash, receipt };
  }

  /**
   * Send a batch of transactions from a deployed ZKAP wallet.
   * Flow: ZkapBuilder.setSender → setExecuteBatchCallData → autoFillUserOp → sign → submit
   */
  async sendBatchTransaction(params: {
    sender: string;
    transactions: Array<{ to: string; value: string; data?: string }>;
    signer: IUserOpSigner;
    chainId: number;
  }): Promise<{ userOpHash: string; receipt: Promise<UserOpReceipt> }> {
    const { sender, transactions, signer, chainId } = params;
    const chainConfig = await this.chainRegistry.getChainConfig(chainId);

    const builder = new ZkapBuilder({
      chainId,
      entryPoint: chainConfig.entryPoint,
      enUrl: chainConfig.rpcUrl,
    });

    const addresses = transactions.map((tx) => tx.to);
    const values = transactions.map((tx) => tx.value);
    const dataList = transactions.map((tx) => tx.data || "0x");

    builder
      .setSender(sender)
      .setExecuteBatchCallData(addresses, values, dataList, signer.keyTypes);

    await builder.autoFillUserOp();

    const userOpHash = builder.getUserOpHash();
    const signatures = await signer.signUserOpHash(userOpHash);

    const keyIndexList = signer.keyTypes.map((_, i) => i);
    builder.setSignature(keyIndexList, signatures);

    const packedUserOp = builder.getPackedUserOp();
    const submittedHash = await this.bundlerClient.submitUserOp(packedUserOp, chainConfig.entryPoint);

    const receipt = this.bundlerClient.waitForReceipt(submittedHash, undefined);
    return { userOpHash: submittedHash, receipt };
  }

  /**
   * Check if a wallet is deployed on the given chain.
   */
  async isDeployed(address: string, chainId: number): Promise<boolean> {
    const chainConfig = await this.chainRegistry.getChainConfig(chainId);
    return this.getAccountReader(chainConfig).isDeployed(address);
  }

  /**
   * Get native token balance of a wallet (in wei, as a string).
   */
  async getBalance(address: string, chainId: number): Promise<string> {
    const chainConfig = await this.chainRegistry.getChainConfig(chainId);
    return this.getAccountReader(chainConfig).getBalance(address);
  }

  /**
   * Get the list of registered txKeys for a wallet.
   */
  async getTxKeyList(address: string, chainId: number): Promise<TxKeyInfo[]> {
    const chainConfig = await this.chainRegistry.getChainConfig(chainId);
    return this.getAccountReader(chainConfig).getTxKeyList(address);
  }

  /**
   * Find txKeys matching the given rpIdHash (SHA-256 of rpId).
   * Returns all WebAuthn keys whose allowedRpIdHash matches.
   */
  async findTxKeysByRpId(address: string, chainId: number, rpIdHash: string): Promise<TxKeyInfo[]> {
    const chainConfig = await this.chainRegistry.getChainConfig(chainId);
    return this.getAccountReader(chainConfig).findTxKeysByRpId(address, rpIdHash);
  }
}
