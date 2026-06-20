import { BaseAccount } from "./BaseAccount";
import { IUserOpSigner } from "../utils/IUserOpSigner";
import { ethers } from "ethers";
import EntryPoint from "../types/abi/EntryPoint.json";
import { PackedUserOperation } from "../types/UserOperation";
import { AaOperationError, AaOperationErrorCode, AaFetchError, AaFetchErrorCode } from "../errors";

export class ZkapAccount extends BaseAccount {
  private signer: IUserOpSigner;
  private provider: ethers.JsonRpcProvider;
  private entryPoint: ethers.Contract;
  private readonly enUrl: string;

  constructor(
    address: string,
    signer: IUserOpSigner,
    enUrl: string,
    entryPointAddress: string
  ) {
    super(address);
    if (!ethers.isAddress(entryPointAddress) || entryPointAddress === ethers.ZeroAddress) {
      throw new AaOperationError({
        code: AaOperationErrorCode.INPUT_INVALID_ADDRESS,
        operation: "init_zkap_account",
        message: `Invalid entryPointAddress: "${entryPointAddress}". Must be a non-zero Ethereum address.`,
      });
    }
    this.signer = signer;
    try {
      new URL(enUrl);
    } catch {
      throw new AaOperationError({
        code: AaOperationErrorCode.INPUT_INVALID_URL,
        operation: "init_zkap_account",
        message: `Invalid enUrl: "${enUrl}". Must be a valid URL.`,
      });
    }
    this.enUrl = enUrl;
    this.provider = new ethers.JsonRpcProvider(enUrl);
    this.entryPoint = new ethers.Contract(
      entryPointAddress,
      EntryPoint.abi,
      this.provider
    );
  }

  async signUserOpHash(opHash: string): Promise<string[]> {
    return this.signer.signUserOpHash(opHash);
  }

  async getNonce(nonceKey: bigint = 0n): Promise<bigint> {
    try {
      const nonce = await this.entryPoint.getNonce(this.address, nonceKey);
      return nonce;
    } catch (error) {
      throw new AaFetchError({
        code: AaFetchErrorCode.TRANSPORT,
        operation: "get_nonce",
        service: "rpc",
        url: this.enUrl,
        method: "POST",
        cause: error,
        message:
          `Failed to fetch nonce from entryPoint for account ${this.address} (nonceKey=${nonceKey.toString()}): ` +
          `${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  /**
   * Sends a UserOperation to the ERC-4337 bundler.
   * @param packedUserOp The PackedUserOperation to send
   * @returns The userOpHash returned by the bundler (0x + 64 hex chars)
   */
  async sendTransaction(packedUserOp: PackedUserOperation): Promise<string> {
    const entryPointAddress = await this.entryPoint.getAddress();
    // ERC-4337 standard bundler RPC: eth_sendUserOperation
    // The provider must be a bundler-compatible endpoint
    const userOpHash = await this.provider.send("eth_sendUserOperation", [
      {
        sender: packedUserOp.sender,
        nonce: packedUserOp.nonce,
        initCode: packedUserOp.initCode,
        callData: packedUserOp.callData,
        accountGasLimits: packedUserOp.accountGasLimits,
        preVerificationGas: packedUserOp.preVerificationGas,
        gasFees: packedUserOp.gasFees,
        paymasterAndData: packedUserOp.paymasterAndData,
        signature: packedUserOp.signature,
      },
      entryPointAddress,
    ]);
    if (typeof userOpHash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(userOpHash)) {
      throw new AaFetchError({
        code: AaFetchErrorCode.RESPONSE_SHAPE,
        operation: "send_transaction",
        service: "bundler",
        url: this.enUrl,
        method: "POST",
        message: `Bundler returned invalid userOpHash: ${userOpHash}`,
      });
    }
    return userOpHash;
  }
}
