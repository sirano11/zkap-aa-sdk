import { ethers } from "ethers";
import { SwapParams, SwapTxData } from "../../types/Swap";
import { AaOperationError, AaOperationErrorCode, AaFetchError, AaFetchErrorCode } from "../../errors";

/**
 * 1inch DEX aggregator client that wraps the 1inch Swap API v6.0.
 *
 * Provides methods to check ERC-20 token allowances, build approval
 * transactions, and fetch optimized swap calldata across supported chains.
 *
 * @example
 * ```ts
 * const aggregator = new OneInchAggregator(1, "MY_1INCH_API_KEY");
 * const swapTx = await aggregator.getSwapTxData({ src, dst, amount, from });
 * ```
 */
export class OneInchAggregator {
  private BASE_URL = "https://api.1inch.dev/swap/v6.0/";
  private apiBaseUrl: string;
  private apiKey: string;
  private static readonly FETCH_TIMEOUT_MS = 30000; // 30 seconds

  /**
   * Creates a `OneInchAggregator` instance targeting a specific chain.
   *
   * @param chainId - EVM chain ID (e.g. `1` for Ethereum mainnet).
   * @param apiKey - 1inch API key used to authenticate requests.
   * @throws If the resolved API base URL does not use HTTPS.
   */
  constructor(chainId: number, apiKey: string) {
    this.apiBaseUrl = this.BASE_URL + chainId;
    const url = new URL(this.apiBaseUrl);
    if (url.protocol !== "https:") {
      throw new AaOperationError({
        code: AaOperationErrorCode.INPUT_INVALID_URL,
        operation: "init_one_inch_aggregator",
        message: "OneInchAggregator requires HTTPS",
      });
    }
    this.apiKey = apiKey;
  }

  private getHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      accept: "application/json",
    };
  }

  /**
   * Constructs a full 1inch API request URL by appending `methodName` and
   * serialized `queryParams` to the chain-specific base URL.
   *
   * @param methodName - API path segment (e.g. `"/approve/allowance"`).
   * @param queryParams - Key-value pairs serialized as query string parameters.
   * @returns The fully-qualified request URL string.
   */
  // Construct full API request URL
  apiRequestUrl(methodName: string, queryParams: Record<string, string>): string {
    return (
      this.apiBaseUrl +
      methodName +
      "?" +
      new URLSearchParams(queryParams).toString()
    );
  }

  /**
   * Queries the current ERC-20 allowance granted to the 1inch router contract
   * for the given token and wallet.
   *
   * @param tokenAddress - Ethereum address of the ERC-20 token.
   * @param walletAddress - Ethereum address of the token owner.
   * @returns The current allowance as a decimal string, or `null` if the API
   *   does not return an allowance value.
   * @throws If the API request fails, returns a non-OK status, or times out
   *   after {@link FETCH_TIMEOUT_MS} milliseconds.
   *
   * @example
   * ```ts
   * const allowance = await aggregator.checkAllowance(tokenAddress, walletAddress);
   * if (allowance === "0") {
   *   // need approval
   * }
   * ```
   */
  async checkAllowance(
    tokenAddress: string,
    walletAddress: string
  ): Promise<string | null> {
    const url = this.apiRequestUrl("/approve/allowance", { tokenAddress, walletAddress });
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), OneInchAggregator.FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(url, { method: "GET", headers: this.getHeaders(), signal: controller.signal });
      if (!response.ok) {
        throw new AaFetchError({
          code: AaFetchErrorCode.HTTP_STATUS,
          httpStatus: response.status,
          operation: "check_allowance",
          service: "swap_aggregator",
          url: String(url),
          method: "GET",
          message: `Error fetching allowance: ${response.status} ${response.statusText}`,
        });
      }
      const data = await response.json();
      return data.allowance ?? null;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new AaFetchError({
          code: AaFetchErrorCode.TIMEOUT,
          operation: "check_allowance",
          service: "swap_aggregator",
          url: String(url),
          method: "GET",
          message: `Request timed out after ${OneInchAggregator.FETCH_TIMEOUT_MS}ms`,
        });
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Fetches the transaction data needed to approve the 1inch router to spend
   * the given token on behalf of the user.
   *
   * @param tokenAddress - Ethereum address of the ERC-20 token to approve.
   * @param amount - Amount to approve in the token's smallest unit (decimal
   *   string). Omit to approve the maximum (`uint256` max) amount.
   * @returns {@link SwapTxData} containing the approval contract address,
   *   calldata, and value.
   * @throws If the API returns a non-OK response, the response contains an
   *   invalid address or hex data, or the request times out.
   *
   * @example
   * ```ts
   * const approval = await aggregator.getApprovalTxData(tokenAddress, "1000000");
   * ```
   */
  async getApprovalTxData(tokenAddress: string, amount?: string): Promise<SwapTxData> {
    const url = this.apiRequestUrl(
      "/approve/transaction",
      amount ? { tokenAddress, amount } : { tokenAddress }
    );

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), OneInchAggregator.FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        method: "GET",
        headers: new Headers(this.getHeaders()),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new AaFetchError({
          code: AaFetchErrorCode.HTTP_STATUS,
          httpStatus: response.status,
          operation: "get_approval_tx_data",
          service: "swap_aggregator",
          url: String(url),
          method: "GET",
          message: `HTTP Error! Status: ${response.status} - ${response.statusText}`,
        });
      }

      const transaction = await response.json();

      const approvalTo = transaction.to;
      const approvalData = transaction.data;
      if (!approvalTo || !ethers.isAddress(approvalTo)) {
        throw new AaFetchError({
          code: AaFetchErrorCode.RESPONSE_SHAPE,
          operation: "get_approval_tx_data",
          service: "swap_aggregator",
          url: String(url),
          method: "GET",
          message: `Invalid approval response: 'to' is not a valid address: ${approvalTo}`,
        });
      }
      if (typeof approvalData !== 'string' || !/^0x([0-9a-fA-F]{2})*$/.test(approvalData)) {
        throw new AaFetchError({
          code: AaFetchErrorCode.RESPONSE_SHAPE,
          operation: "get_approval_tx_data",
          service: "swap_aggregator",
          url: String(url),
          method: "GET",
          message: 'Invalid approval response: data is not valid hex',
        });
      }
      return {
        contractAddress: approvalTo,
        value: String(transaction.value ?? '0'),
        data: approvalData,
      };
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new AaFetchError({
          code: AaFetchErrorCode.TIMEOUT,
          operation: "get_approval_tx_data",
          service: "swap_aggregator",
          url: String(url),
          method: "GET",
          message: `Request timed out after ${OneInchAggregator.FETCH_TIMEOUT_MS}ms`,
        });
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Fetches optimized swap transaction data from the 1inch Swap API.
   *
   * The API finds the best route across on-chain liquidity sources for the
   * given token pair and returns calldata ready for on-chain submission.
   *
   * @param swapParams - Swap parameters including source/destination tokens,
   *   amount, sender address, and optional slippage / partial-fill settings.
   *   See {@link SwapParams}.
   * @returns {@link SwapTxData} containing the router contract address,
   *   calldata, and ETH value to send with the transaction.
   * @throws If the API returns a 400 error (invalid parameters), any other
   *   non-OK HTTP status, an invalid response payload, or if the request
   *   times out.
   *
   * @example
   * ```ts
   * const swapTx = await aggregator.getSwapTxData({
   *   src: "0xSrcToken...",
   *   dst: "0xDstToken...",
   *   amount: "1000000000000000000",
   *   from: "0xWallet...",
   *   slippage: 0.01,
   * });
   * ```
   */
  async getSwapTxData(swapParams: SwapParams): Promise<SwapTxData> {
    // Filter undefined values and convert to strings for URL params
    const stringParams: Record<string, string> = Object.fromEntries(
      Object.entries(swapParams)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, String(v)])
    );
    const url = this.apiRequestUrl("/swap", stringParams);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), OneInchAggregator.FETCH_TIMEOUT_MS);
    try {
      // Fetch the swap transaction details from the API
      const response = await fetch(url, {
        method: "GET",
        headers: this.getHeaders(),
        signal: controller.signal,
      });

      if (!response.ok) {
        if (response.status === 400) {
          const errorData = await response.json();
          throw new AaFetchError({
            code: AaFetchErrorCode.HTTP_STATUS,
            httpStatus: response.status,
            operation: "get_swap_tx_data",
            service: "swap_aggregator",
            url: String(url),
            method: "GET",
            message: `1inch API error (400): ${JSON.stringify(errorData)}`,
          });
        }
        throw new AaFetchError({
          code: AaFetchErrorCode.HTTP_STATUS,
          httpStatus: response.status,
          operation: "get_swap_tx_data",
          service: "swap_aggregator",
          url: String(url),
          method: "GET",
          message: `HTTP Error! Status: ${response.status} - ${response.statusText}`,
        });
      }

      const transaction = await response.json();

      const swapTo = transaction.tx?.to;
      const swapData = transaction.tx?.data;
      if (!swapTo || !ethers.isAddress(swapTo)) {
        throw new AaFetchError({
          code: AaFetchErrorCode.RESPONSE_SHAPE,
          operation: "get_swap_tx_data",
          service: "swap_aggregator",
          url: String(url),
          method: "GET",
          message: `Invalid swap response: 'to' is not a valid address: ${swapTo}`,
        });
      }
      if (typeof swapData !== 'string' || !/^0x([0-9a-fA-F]{2})*$/.test(swapData)) {
        throw new AaFetchError({
          code: AaFetchErrorCode.RESPONSE_SHAPE,
          operation: "get_swap_tx_data",
          service: "swap_aggregator",
          url: String(url),
          method: "GET",
          message: 'Invalid swap response: data is not valid hex',
        });
      }
      return {
        contractAddress: swapTo,
        value: String(transaction.tx?.value ?? '0'),
        data: swapData,
      };
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new AaFetchError({
          code: AaFetchErrorCode.TIMEOUT,
          operation: "get_swap_tx_data",
          service: "swap_aggregator",
          url: String(url),
          method: "GET",
          message: `Request timed out after ${OneInchAggregator.FETCH_TIMEOUT_MS}ms`,
        });
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

export default OneInchAggregator;
