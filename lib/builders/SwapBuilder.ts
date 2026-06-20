import { SwapParams, SwapTxData } from "../types/Swap";
import { OneInchAggregator } from "./aggregators/OneInchAggregator";
import { ethers } from "ethers";
import { AaOperationError, AaOperationErrorCode } from "../errors";

interface ISwapAggregator {
  checkAllowance(tokenAddress: string, walletAddress: string): Promise<string | null>;
  getApprovalTxData(tokenAddress: string, amount?: string): Promise<SwapTxData>;
  getSwapTxData(swapParams: SwapParams): Promise<SwapTxData>;
}

/**
 * Builds token-swap transaction data by delegating to an underlying DEX
 * aggregator such as 1inch.
 *
 * `SwapBuilder` is the primary entry point for constructing swap and approval
 * calldata that can be embedded into ERC-4337 UserOperations. It validates
 * inputs before forwarding requests to the chosen aggregator.
 *
 * Supported aggregators: `"1inch"`.
 *
 * @example
 * ```ts
 * const swapBuilder = new SwapBuilder("1inch", 1, "MY_API_KEY", bundlerAddress);
 *
 * // Build approval calldata (if the token allowance is insufficient)
 * const approval = await swapBuilder.getApprovalTxData(tokenAddress, amount);
 *
 * // Build swap calldata
 * const swap = await swapBuilder.getSwapTxData({
 *   src: "0xSrcToken...",
 *   dst: "0xDstToken...",
 *   amount: "1000000000000000000",
 *   from: "0xWallet...",
 * });
 * ```
 */
export class SwapBuilder {
  private aggregator: ISwapAggregator;
  private bundlerAddress: string;

  private static readonly AggregatorName = {
    ONEINCH: "1inch",
    UNISWAP: "uniswap",
    CURVE: "curve",
    BALANCER: "balancer",
  };

  /**
   * Creates a `SwapBuilder` configured for the given aggregator and chain.
   *
   * @param aggregatorName - Name of the DEX aggregator to use (e.g. `"1inch"`).
   * @param chainId - EVM chain ID for the target network (must be a positive integer).
   * @param apiKey - API key for the chosen aggregator.
   * @param bundlerAddress - Ethereum address of the ERC-4337 bundler, passed as
   *   the referral `origin` to the aggregator.
   * @throws If `chainId` is not a positive integer.
   * @throws If `apiKey` is empty.
   * @throws If `bundlerAddress` is not a valid Ethereum address.
   * @throws If `aggregatorName` refers to an unsupported aggregator.
   */
  constructor(
    aggregatorName: string,
    chainId: number,
    apiKey: string,
    bundlerAddress: string
  ) {
    if (!Number.isInteger(chainId) || chainId <= 0) {
      throw new AaOperationError({
        code: AaOperationErrorCode.INPUT_OUT_OF_RANGE,
        operation: "init_swap_builder",
        message: `SwapBuilder: chainId must be a positive integer, got ${chainId}`,
      });
    }
    if (!apiKey || apiKey.trim().length === 0) {
      throw new AaOperationError({
        code: AaOperationErrorCode.CONFIG_REQUIRED_FIELD_MISSING,
        operation: "init_swap_builder",
        message: 'SwapBuilder: apiKey must be a non-empty string',
      });
    }
    if (!ethers.isAddress(bundlerAddress)) {
      throw new AaOperationError({
        code: AaOperationErrorCode.INPUT_INVALID_ADDRESS,
        operation: "init_swap_builder",
        message: `SwapBuilder: bundlerAddress is not a valid Ethereum address: "${bundlerAddress}"`,
      });
    }
    this.bundlerAddress = bundlerAddress;

    switch (aggregatorName) {
      case SwapBuilder.AggregatorName.ONEINCH:
        this.aggregator = new OneInchAggregator(chainId, apiKey);
        break;
      default:
        throw new AaOperationError({
          code: AaOperationErrorCode.INPUT_UNSUPPORTED,
          operation: "init_swap_builder",
          message: `Unsupported aggregator: "${aggregatorName}". Supported: ${Object.values(SwapBuilder.AggregatorName).join(", ")}`,
        });
    }
  }

  /**
   * Fetches the calldata required to execute a token swap through the
   * configured aggregator.
   *
   * The `bundlerAddress` is automatically injected as the `origin` referral
   * field. Default values are applied for `slippage` (1%), `disableEstimate`
   * (false), and `allowPartialFill` (true) when not provided.
   *
   * @param params - Swap parameters. See {@link SwapParams}.
   * @returns Transaction data ({@link SwapTxData}) ready to be submitted via a UserOperation.
   * @throws If `src`, `dst`, or `from` are not valid Ethereum addresses.
   * @throws If the aggregator API call fails.
   *
   * @example
   * ```ts
   * const swapTx = await swapBuilder.getSwapTxData({
   *   src: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", // USDC
   *   dst: "0x6B175474E89094C44Da98b954EedeAC495271d0F", // DAI
   *   amount: "1000000", // 1 USDC (6 decimals)
   *   from: "0xYourWallet...",
   *   slippage: 0.005,
   * });
   * ```
   */
  public async getSwapTxData({
    src,
    dst,
    amount,
    from,
    slippage = 0.01,
    disableEstimate = false,
    allowPartialFill = true,
  }: SwapParams): Promise<SwapTxData> {
    if (!ethers.isAddress(src)) {
      throw new AaOperationError({
        code: AaOperationErrorCode.INPUT_INVALID_ADDRESS,
        operation: "get_swap_tx_data",
        message: `SwapBuilder: src is not a valid Ethereum address: "${src}"`,
      });
    }
    if (!ethers.isAddress(dst)) {
      throw new AaOperationError({
        code: AaOperationErrorCode.INPUT_INVALID_ADDRESS,
        operation: "get_swap_tx_data",
        message: `SwapBuilder: dst is not a valid Ethereum address: "${dst}"`,
      });
    }
    if (!ethers.isAddress(from)) {
      throw new AaOperationError({
        code: AaOperationErrorCode.INPUT_INVALID_ADDRESS,
        operation: "get_swap_tx_data",
        message: `SwapBuilder: from is not a valid Ethereum address: "${from}"`,
      });
    }
    const swapData = await this.aggregator.getSwapTxData({
      src: src,
      dst: dst,
      amount: amount,
      from: from,
      origin: this.bundlerAddress,
      slippage: slippage,
      disableEstimate: disableEstimate,
      allowPartialFill: allowPartialFill,
    });

    return swapData;
  }

  /**
   * Fetches the calldata required to approve the aggregator router contract
   * to spend a given token on behalf of the user.
   *
   * Call this before {@link getSwapTxData} when the current token allowance is
   * insufficient.
   *
   * @param token - Ethereum address of the ERC-20 token to approve.
   * @param amount - Amount to approve in the token's smallest unit (as a
   *   decimal string). Omit or pass `undefined` to approve the maximum amount.
   * @returns Transaction data ({@link SwapTxData}) for the approval call.
   * @throws If the aggregator API call fails.
   *
   * @example
   * ```ts
   * const approvalTx = await swapBuilder.getApprovalTxData(
   *   "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
   *   "1000000"
   * );
   * ```
   */
  public async getApprovalTxData(
    token: string,
    amount: string
  ): Promise<SwapTxData> {
    const approvalData = await this.aggregator.getApprovalTxData(
      token,
      amount
    );

    return approvalData;
  }
}
