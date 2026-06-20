import { UserOperation } from "../types/UserOperation";
import { ethers } from "ethers";
import { AaOperationError, AaOperationErrorCode, AaFetchError, AaFetchErrorCode } from "../errors";

export enum PaymasterMode {
  // NONE = 0,
  VERIFYING = 0,
  ERC20 = 1,
}

export interface PaymasterServiceConfig {
  /**
   * Paymaster server URL (e.g. "http://127.0.0.1:3000")
   */
  serverUrl: string;
  /**
   * Paymaster contract address
   */
  paymasterAddress: string;
  /**
   * Chain ID
   */
  chainId: number;

  mode: PaymasterMode;

  /**
   * Token address to use in ERC20 mode.
   * Required when PaymasterMode.ERC20 is set.
   */
  tokenAddress?: string;
}

export interface PaymasterDataResponse {
  userOp: {
    paymasterData: string;
  };
}

// Empirically measured gas limits for each paymaster mode
const VERIFYING_PAYMASTER_VERIFICATION_GAS = 27000n;
const VERIFYING_PAYMASTER_POST_OP_GAS = 0n;
const ERC20_PAYMASTER_VERIFICATION_GAS = 40000n;
const ERC20_PAYMASTER_POST_OP_GAS = 100000n;

/**
 * Paymaster service class.
 * Communicates with the paymaster server to retrieve paymaster data.
 */
export class PaymasterService {
  private static readonly FETCH_TIMEOUT_MS = 30_000;
  private config: PaymasterServiceConfig;
  private static isValidMode(mode: number): mode is PaymasterMode {
    return mode === PaymasterMode.VERIFYING || mode === PaymasterMode.ERC20;
  }

  constructor(config: PaymasterServiceConfig) {
    let url: URL;
    try {
      url = new URL(config.serverUrl);
    } catch {
      throw new AaOperationError({
        code: AaOperationErrorCode.INPUT_INVALID_URL,
        operation: "init_paymaster_service",
        message: `PaymasterService: serverUrl is not a valid URL: "${config.serverUrl}"`,
      });
    }
    if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
      throw new AaOperationError({
        code: AaOperationErrorCode.INPUT_INVALID_URL,
        operation: "init_paymaster_service",
        message: 'PaymasterService serverUrl must use HTTPS. HTTP is only allowed for localhost.',
      });
    }
    if (!ethers.isAddress(config.paymasterAddress)) {
      throw new AaOperationError({
        code: AaOperationErrorCode.INPUT_INVALID_ADDRESS,
        operation: "init_paymaster_service",
        message: `PaymasterService: paymasterAddress is not a valid Ethereum address: "${config.paymasterAddress}"`,
      });
    }
    if (!PaymasterService.isValidMode(config.mode)) {
      throw new AaOperationError({
        code: AaOperationErrorCode.INPUT_UNSUPPORTED,
        operation: "init_paymaster_service",
        message: `PaymasterService: unsupported mode: ${config.mode}`,
      });
    }
    if (config.mode === PaymasterMode.ERC20) {
      if (!config.tokenAddress) {
        throw new AaOperationError({
          code: AaOperationErrorCode.CONFIG_REQUIRED_FIELD_MISSING,
          operation: "init_paymaster_service",
          message: 'PaymasterService: tokenAddress is required for ERC20 mode',
        });
      }
      if (!ethers.isAddress(config.tokenAddress)) {
        throw new AaOperationError({
          code: AaOperationErrorCode.INPUT_INVALID_ADDRESS,
          operation: "init_paymaster_service",
          message: `PaymasterService: tokenAddress is not a valid Ethereum address: "${config.tokenAddress}"`,
        });
      }
    }
    this.config = Object.freeze({ ...config });
  }

  private requestCounter = 0;

  private getRequestId(): number {
    return ++this.requestCounter;
  }

  async getPaymasterData(userOp: UserOperation): Promise<string> {
    if (this.config.mode === PaymasterMode.VERIFYING) {
      return this.getPaymasterDataVerifying(userOp);
    } else if (this.config.mode === PaymasterMode.ERC20) {
      return this.getPaymasterDataErc20(userOp);
    }
    throw new AaOperationError({
      code: AaOperationErrorCode.INPUT_UNSUPPORTED,
      operation: "get_paymaster_data",
      message: "Invalid paymaster mode",
    });
  }

  /**
   * Sends an RPC request to the paymaster server and returns paymasterData.
   * @param endpoint Request path (e.g. "/paymaster/get-paymaster-data")
   * @param params Array of RPC params
   * @returns paymasterData string
   */
  private async requestPaymasterData(
    endpoint: string,
    params: unknown[]
  ): Promise<string> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), PaymasterService.FETCH_TIMEOUT_MS);
    const url = `${this.config.serverUrl}${endpoint}`;
    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "pm_getPaymasterData",
          params,
          id: this.getRequestId(),
        }),
      });
    } catch (fetchError) {
      if (fetchError instanceof Error && fetchError.name === 'AbortError') {
        throw new AaFetchError({
          code: AaFetchErrorCode.TIMEOUT,
          operation: "request_paymaster_data",
          service: "paymaster",
          url,
          method: "POST",
          message: `Paymaster request timed out after ${PaymasterService.FETCH_TIMEOUT_MS}ms`,
        });
      }
      throw fetchError;
    } finally {
      clearTimeout(timeoutId);
    }
    if (!response.ok) {
      let responseText = "";
      try {
        responseText = await response.text();
      } catch {
        // ignore body read failures
      }
      throw new AaFetchError({
        code: AaFetchErrorCode.HTTP_STATUS,
        httpStatus: response.status,
        operation: "request_paymaster_data",
        service: "paymaster",
        url,
        method: "POST",
        rawResponse: responseText,
        message: `Paymaster data request failed: ${response.status} ${response.statusText}${responseText ? `: ${responseText}` : ""}`,
      });
    }
    let data: { result?: PaymasterDataResponse; error?: unknown };
    try {
      data = await response.json();
    } catch (jsonError) {
      throw new AaFetchError({
        code: AaFetchErrorCode.RESPONSE_SHAPE,
        operation: "request_paymaster_data",
        service: "paymaster",
        url,
        method: "POST",
        cause: jsonError,
        message: `Paymaster data error: invalid JSON response (${jsonError instanceof Error ? jsonError.message : String(jsonError)})`,
      });
    }
    if (data.error) {
      const errMsg = (typeof data.error === 'object' && data.error !== null && 'message' in data.error)
        ? (data.error as { message: string }).message
        : JSON.stringify(data.error);
      throw new AaFetchError({
        code: AaFetchErrorCode.RESPONSE_SHAPE,
        operation: "request_paymaster_data",
        service: "paymaster",
        url,
        method: "POST",
        rawResponse: JSON.stringify(data.error),
        message: `Paymaster data error: ${errMsg}`,
      });
    }
    if (!data.result) {
      throw new AaFetchError({
        code: AaFetchErrorCode.RESPONSE_SHAPE,
        operation: "request_paymaster_data",
        service: "paymaster",
        url,
        method: "POST",
        message: "Paymaster data error: result is not found",
      });
    }
    if (!data.result.userOp || typeof data.result.userOp !== "object") {
      throw new AaFetchError({
        code: AaFetchErrorCode.RESPONSE_SHAPE,
        operation: "request_paymaster_data",
        service: "paymaster",
        url,
        method: "POST",
        message: "Paymaster data error: result.userOp is not found",
      });
    }
    const paymasterData = data.result.userOp.paymasterData;
    if (typeof paymasterData !== "string" || !/^0x([0-9a-fA-F]{2})*$/.test(paymasterData)) {
      throw new AaFetchError({
        code: AaFetchErrorCode.RESPONSE_SHAPE,
        operation: "request_paymaster_data",
        service: "paymaster",
        url,
        method: "POST",
        message: `Invalid paymasterData format: expected 0x-prefixed even-length hex string, got ${typeof paymasterData === "string" ? JSON.stringify(paymasterData.substring(0, 20)) : typeof paymasterData}`,
      });
    }
    return paymasterData;
  }

  private buildUserOpParams(userOp: UserOperation): object {
    return {
      sender: userOp.sender,
      nonce: userOp.nonce,
      initCode: userOp.initCode,
      callData: userOp.callData,
      callGasLimit: userOp.callGasLimit,
      verificationGasLimit: userOp.verificationGasLimit,
      preVerificationGas: userOp.preVerificationGas,
      maxPriorityFeePerGas: userOp.maxPriorityFeePerGas,
      maxFeePerGas: userOp.maxFeePerGas,
      paymaster: userOp.paymaster,
      paymasterVerificationGasLimit: userOp.paymasterVerificationGasLimit,
      paymasterPostOpGasLimit: userOp.paymasterPostOpGasLimit,
    };
  }

  /**
   * Retrieves paymaster data.
   * @param userOp UserOperation object
   * @returns Paymaster data
   */
  async getPaymasterDataVerifying(userOp: UserOperation): Promise<string> {
    return this.requestPaymasterData(
      "/paymaster/get-paymaster-data",
      [
        this.buildUserOpParams(userOp),
        this.config.paymasterAddress,
        this.config.chainId.toString(),
      ]
    );
  }

  async getPaymasterDataErc20(userOp: UserOperation): Promise<string> {
    if (!this.config.tokenAddress) {
      throw new AaOperationError({
        code: AaOperationErrorCode.CONFIG_REQUIRED_FIELD_MISSING,
        operation: "get_paymaster_data_erc20",
        message: "tokenAddress is required for ERC20 paymaster mode",
      });
    }
    return this.requestPaymasterData(
      "/paymaster/get-paymaster-data-erc20",
      [
        this.buildUserOpParams(userOp),
        this.config.paymasterAddress,
        this.config.chainId.toString(),
        this.config.tokenAddress,
      ]
    );
  }

  /**
   * Estimates the paymaster verification gas limit.
   * @returns Paymaster verification gas limit
   */
  estimatePaymasterVerificationGasLimit(): bigint {
    if (this.config.mode === PaymasterMode.VERIFYING) {
      return VERIFYING_PAYMASTER_VERIFICATION_GAS;
    } else if (this.config.mode === PaymasterMode.ERC20) {
      return ERC20_PAYMASTER_VERIFICATION_GAS;
    }
    throw new AaOperationError({
      code: AaOperationErrorCode.INPUT_UNSUPPORTED,
      operation: "estimate_paymaster_verification_gas_limit",
      message: "Invalid paymaster mode",
    });
  }

  /**
   * Estimates the paymaster PostOp gas limit.
   * @returns Paymaster PostOp gas limit
   */
  estimatePaymasterPostOpGasLimit(): bigint {
    if (this.config.mode === PaymasterMode.VERIFYING) {
      return VERIFYING_PAYMASTER_POST_OP_GAS;
    } else if (this.config.mode === PaymasterMode.ERC20) {
      return ERC20_PAYMASTER_POST_OP_GAS;
    }
    throw new AaOperationError({
      code: AaOperationErrorCode.INPUT_UNSUPPORTED,
      operation: "estimate_paymaster_post_op_gas_limit",
      message: "Invalid paymaster mode",
    });
  }
  getConfig(): Readonly<PaymasterServiceConfig> {
    return { ...this.config };
  }
}
