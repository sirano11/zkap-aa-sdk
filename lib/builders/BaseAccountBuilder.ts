import { UserOperation, PackedUserOperation } from "../types/UserOperation";
import { ethers } from "ethers";
import { AaOperationError, AaOperationErrorCode, AaFetchError, AaFetchErrorCode } from "../errors";

export abstract class BaseAccountBuilder {
  /** Multiplier to add 20% buffer to gas estimates (120/100 = 1.2x) */
  protected static readonly GAS_ESTIMATE_MULTIPLIER = BigInt(120);
  protected static readonly GAS_ESTIMATE_DIVISOR = BigInt(100);
  /** minimum paymasterAndData hex length: (20 + 16 + 16 + 65) * 2 + 2("0x") = 236 */
  protected static readonly PAYMASTER_AND_DATA_MIN_HEX_LENGTH = 236;
  /** Default paymaster postOp gas: empirical lower bound for typical ERC-4337 postOp operations (e.g. token transfer) */
  protected static readonly DEFAULT_PAYMASTER_POST_OP_GAS = BigInt(5000);
  /**
   * Default upper bound for `gasLimit` in internal `eth_estimateGas` calls.
   * Some public RPCs (observed on Base Sepolia) reject requests without an
   * explicit `gas` or with `gas` above ~17M with "intrinsic gas too high".
   * 15M = ~26x headroom over 574K observed worst-case (wallet deploy),
   * safely under the observed cap, and within every supported chain's blockGasLimit.
   * Override via constructor `rpcEstimateGasCap` arg. Set to 0n to opt out (no gas field injected).
   */
  private static readonly DEFAULT_RPC_ESTIMATE_GAS_CAP = BigInt(15_000_000);
  protected userOp: Partial<UserOperation> = {};
  protected chainId: number;
  protected entryPoint: string;
  protected provider?: ethers.JsonRpcProvider;
  private readonly rpcEstimateGasCap: bigint;

  abstract setInitCode(...args: unknown[]): this;
  abstract setSignature(
    keyIndexList: number[],
    keySignatureList: string[]
  ): this;

  constructor(
    chainId: number,
    entryPoint: string,
    provider?: ethers.JsonRpcProvider,
    rpcEstimateGasCap?: bigint
  ) {
    if (!Number.isInteger(chainId) || chainId <= 0) {
      throw new AaOperationError({
        code: AaOperationErrorCode.INPUT_OUT_OF_RANGE,
        operation: "init_base_account_builder",
        message: `Invalid chainId: ${chainId}. Must be a positive integer.`,
      });
    }
    if (!ethers.isAddress(entryPoint) || entryPoint === ethers.ZeroAddress) {
      throw new AaOperationError({
        code: AaOperationErrorCode.INPUT_INVALID_ADDRESS,
        operation: "init_base_account_builder",
        message: `Invalid entryPoint address: "${entryPoint}". Must be a non-zero Ethereum address.`,
      });
    }
    this.chainId = chainId;
    this.entryPoint = entryPoint;
    this.provider = provider;
    this.rpcEstimateGasCap =
      rpcEstimateGasCap ?? BaseAccountBuilder.DEFAULT_RPC_ESTIMATE_GAS_CAP;
  }

  /**
   * Wraps `provider.estimateGas` with a bounded `gasLimit` to work around
   * public RPCs that reject unbounded estimate requests (observed on Base Sepolia).
   *
   * Priority (first match wins):
   *   1. Caller-supplied `tx.gasLimit === 0n` → field is dropped (caller opts out)
   *   2. Caller-supplied `tx.gasLimit > 0` → used as-is
   *   3. Caller unset + `rpcEstimateGasCap === 0n` → field is dropped (option opts out)
   *   4. Caller unset + cap > 0 → cap is injected
   *
   * `this.provider` is guaranteed by callers (autoFillUserOp checks early).
   */
  protected async estimateGasWithCap(
    tx: ethers.TransactionRequest
  ): Promise<bigint> {
    // ethers v6 TransactionRequest.gasLimit is BigNumberish (bigint | number | string).
    // Normalize so callers passing `0` or `"0x0"` are treated the same as `0n`.
    const explicit =
      tx.gasLimit != null ? BigInt(tx.gasLimit) : undefined;

    if (explicit === BigInt(0)) {
      const rest: ethers.TransactionRequest = { ...tx };
      delete rest.gasLimit;
      return this.provider!.estimateGas(rest);
    }
    if (explicit !== undefined) {
      return this.provider!.estimateGas(tx);
    }
    if (this.rpcEstimateGasCap === BigInt(0)) {
      return this.provider!.estimateGas(tx);
    }
    return this.provider!.estimateGas({
      ...tx,
      gasLimit: this.rpcEstimateGasCap,
    });
  }

  protected applyDefaults(): void {
    const defaultValues: UserOperation = {
      sender: ethers.ZeroAddress,
      nonce: ethers.toBeHex("0"),
      initCode: "0x",
      callData: "0x",
      callGasLimit: "0x00",
      verificationGasLimit: ethers.toBeHex("1500000"),
      preVerificationGas: ethers.toBeHex("210000"),
      maxFeePerGas: "0x00",
      maxPriorityFeePerGas: ethers.toBeHex("1000000000"),
      paymaster: ethers.ZeroAddress,
      paymasterData: "0x",
      paymasterVerificationGasLimit: "0x00",
      paymasterPostOpGasLimit: "0x00",
      signature: "0x",
    };

    this.userOp = { ...defaultValues, ...this.userOp };
  }

  /**
   * ABI-encodes a UserOp for paymaster UserOperation hash calculation.
   * @requires autoFillUserOp() must be completed before calling this method.
   *           If not, paymasterAndData may be incorrect and an invalid hash will be computed.
   * @param packedUserOp The PackedUserOperation to encode
   * @param paymasterSigBytes Number of bytes in the paymaster signature (default 65)
   * @returns ABI-encoded UserOperation string
   */
  encodeUserOpForPaymaster(packedUserOp: PackedUserOperation, paymasterSigBytes: number = 65): string {
    if (!Number.isInteger(paymasterSigBytes) || paymasterSigBytes < 1 || paymasterSigBytes > 256) {
      throw new AaOperationError({
        code: AaOperationErrorCode.INPUT_OUT_OF_RANGE,
        operation: "encode_user_op_for_paymaster",
        message: `Invalid paymasterSigBytes: ${paymasterSigBytes}. Must be an integer between 1 and 256.`,
      });
    }
    const defaultAbiCoder = ethers.AbiCoder.defaultAbiCoder();
    const PAYMASTER_SIG_BYTES = paymasterSigBytes;
    const _PAYMASTER_SIG_HEX_LENGTH = PAYMASTER_SIG_BYTES * 2; // eslint-disable-line @typescript-eslint/no-unused-vars
    // minimum valid payload: paymaster addr(20) + verifyGasLimit(16) + postOpGasLimit(16) + sig(65) = 117 bytes
    // hex representation: 117 * 2 + 2("0x" prefix) = 236 chars
    // Changed from <= PAYMASTER_SIG_HEX_LENGTH + 2 to < 236 to correctly enforce the minimum
    // valid structure (paymaster header + signature). The old condition could reject valid
    // paymasterAndData that is exactly PAYMASTER_SIG_HEX_LENGTH + 2 chars long.
    // 236 = (paymaster_addr(20) + verifyGasLimit(16) + postOpGasLimit(16) + sig(65)) * 2 hex chars + 2 ("0x")
    if (packedUserOp.paymasterAndData.length < BaseAccountBuilder.PAYMASTER_AND_DATA_MIN_HEX_LENGTH) {
      // "0x" prefix(2) + less than minimum sig length means there is no signature area
      throw new AaOperationError({
        code: AaOperationErrorCode.INPUT_INVALID_FORMAT,
        operation: "encode_user_op_for_paymaster",
        message: `paymasterAndData too short to contain signature: length=${packedUserOp.paymasterAndData.length}, expected at least ${BaseAccountBuilder.PAYMASTER_AND_DATA_MIN_HEX_LENGTH}`,
      });
    }
    // paymasterAndData = paymaster_addr(20) + verifyGasLimit(16) + postOpGasLimit(16) + paymasterData
    // The last PAYMASTER_SIG_BYTES bytes of paymasterData are the signature. Signature is always last regardless of mode.
    // C-1: ethers.dataSlice slices by byte (64-bit safe)
    const totalBytes = (packedUserOp.paymasterAndData.length - 2) / 2;
    return defaultAbiCoder.encode(
      [
        "address",
        "uint256",
        "bytes32",
        "uint256",
        "bytes32",
        "bytes32",
        "bytes32",
        "bytes32",
      ],
      [
        packedUserOp.sender,
        packedUserOp.nonce,
        packedUserOp.accountGasLimits,
        packedUserOp.preVerificationGas,
        packedUserOp.gasFees,
        ethers.keccak256(packedUserOp.initCode),
        ethers.keccak256(packedUserOp.callData),
        ethers.keccak256(ethers.dataSlice(packedUserOp.paymasterAndData, 0, totalBytes - PAYMASTER_SIG_BYTES)),
      ]
    );
  }

  encodeUserOp(packedUserOp: PackedUserOperation, forSignature = true): string {
    const defaultAbiCoder = ethers.AbiCoder.defaultAbiCoder();
    if (forSignature) {
      return defaultAbiCoder.encode(
        [
          "address",
          "uint256",
          "bytes32",
          "bytes32",
          "bytes32",
          "uint256",
          "bytes32",
          "bytes32",
        ],
        [
          packedUserOp.sender,
          packedUserOp.nonce,
          ethers.keccak256(packedUserOp.initCode),
          ethers.keccak256(packedUserOp.callData),
          packedUserOp.accountGasLimits,
          packedUserOp.preVerificationGas,
          packedUserOp.gasFees,
          ethers.keccak256(packedUserOp.paymasterAndData),
        ]
      );
    } else {
      // for the purpose of calculating gas cost encode also signature (and no keccak of bytes)
      return defaultAbiCoder.encode(
        [
          "address",
          "uint256",
          "bytes",
          "bytes",
          "bytes32",
          "uint256",
          "bytes32",
          "bytes",
          "bytes",
        ],
        [
          packedUserOp.sender,
          packedUserOp.nonce,
          packedUserOp.initCode,
          packedUserOp.callData,
          packedUserOp.accountGasLimits,
          packedUserOp.preVerificationGas,
          packedUserOp.gasFees,
          packedUserOp.paymasterAndData,
          packedUserOp.signature,
        ]
      );
    }
  }

  packAccountGasLimits(
    verificationGasLimit: string,
    callGasLimit: string
  ): string {
    return ethers.concat([
      ethers.zeroPadValue(ethers.hexlify(verificationGasLimit), 16),
      ethers.zeroPadValue(ethers.hexlify(callGasLimit), 16),
    ]);
  }

  packGasFees(
    maxPriorityFeePerGas: string,
    maxFeePerGas: string
  ): string {
    return ethers.concat([
      ethers.zeroPadValue(ethers.hexlify(maxPriorityFeePerGas), 16),
      ethers.zeroPadValue(ethers.hexlify(maxFeePerGas), 16),
    ]);
  }

  packPaymasterData(
    paymaster: string,
    paymasterVerificationGasLimit: string,
    postOpGasLimit: string,
    paymasterData: string
  ): string {
    return ethers.concat([
      paymaster,
      ethers.zeroPadValue(ethers.hexlify(paymasterVerificationGasLimit), 16),
      ethers.zeroPadValue(ethers.hexlify(postOpGasLimit), 16),
      paymasterData,
    ]);
  }

  packUserOp(userOp: UserOperation): PackedUserOperation {
    const accountGasLimits = this.packAccountGasLimits(
      userOp.verificationGasLimit,
      userOp.callGasLimit
    );
    const gasFees = this.packGasFees(
      userOp.maxPriorityFeePerGas,
      userOp.maxFeePerGas
    );
    let paymasterAndData = "0x";
    if (
      userOp.paymaster &&
      ethers.isAddress(userOp.paymaster) &&
      userOp.paymaster !== ethers.ZeroAddress
    ) {
      paymasterAndData = this.packPaymasterData(
        userOp.paymaster as string,
        userOp.paymasterVerificationGasLimit,
        userOp.paymasterPostOpGasLimit,
        userOp.paymasterData as string
      );
    }
    return {
      sender: userOp.sender,
      nonce: userOp.nonce,
      initCode: userOp.initCode,
      callData: userOp.callData,
      accountGasLimits,
      preVerificationGas: userOp.preVerificationGas,
      gasFees,
      paymasterAndData,
      signature: userOp.signature,
    };
  }

  setUserOp(userOp: UserOperation): this {
    this.userOp = userOp;
    return this;
  }

  /** Sets the smart wallet address that will send this UserOperation. */
  setSender(sender: string): this {
    if (!ethers.isAddress(sender)) {
      throw new AaOperationError({
        code: AaOperationErrorCode.INPUT_INVALID_ADDRESS,
        operation: "set_sender",
        message: `setSender: invalid Ethereum address: "${sender}"`,
      });
    }
    this.userOp.sender = sender;
    return this;
  }

  setNonce(nonce: string): this {
    this.userOp.nonce = nonce;
    return this;
  }

  setCallData(callData: string): this {
    this.userOp.callData = callData;
    return this;
  }

  setCallGasLimit(callGasLimit: string): this {
    this.userOp.callGasLimit = callGasLimit;
    return this;
  }

  setVerificationGasLimit(verificationGasLimit: string): this {
    this.userOp.verificationGasLimit = verificationGasLimit;
    return this;
  }

  setPreVerificationGas(preVerificationGas: string): this {
    this.userOp.preVerificationGas = preVerificationGas;
    return this;
  }

  setMaxFeePerGas(maxFeePerGas: string): this {
    this.userOp.maxFeePerGas = maxFeePerGas;
    return this;
  }

  setMaxPriorityFeePerGas(maxPriorityFeePerGas: string): this {
    this.userOp.maxPriorityFeePerGas = maxPriorityFeePerGas;
    return this;
  }

  setPaymaster(paymaster: string): this {
    if (!ethers.isAddress(paymaster)) {
      throw new AaOperationError({
        code: AaOperationErrorCode.INPUT_INVALID_ADDRESS,
        operation: "set_paymaster",
        message: `setPaymaster: invalid Ethereum address: "${paymaster}"`,
      });
    }
    this.userOp.paymaster = paymaster;
    return this;
  }

  setPaymasterData(paymasterData: string): this {
    this.userOp.paymasterData = paymasterData;
    return this;
  }

  setPaymasterVerificationGasLimit(
    paymasterVerificationGasLimit: string
  ): this {
    this.userOp.paymasterVerificationGasLimit = paymasterVerificationGasLimit;
    return this;
  }

  setPaymasterPostOpGasLimit(paymasterPostOpGasLimit: string): this {
    this.userOp.paymasterPostOpGasLimit = paymasterPostOpGasLimit;
    return this;
  }

  getUserOp(): UserOperation {
    this.applyDefaults(); // Apply defaults only to unset fields (preserves existing values)

    if (!this.userOp.sender || !ethers.isAddress(this.userOp.sender) || this.userOp.sender === ethers.ZeroAddress) {
      throw new AaOperationError({
        code: AaOperationErrorCode.STATE_FIELD_NOT_SET,
        operation: "get_user_op",
        message: "Sender is not set or is zero address. Please set a valid sender address.",
      });
    }

    return this.userOp as UserOperation;
  }

  /** Returns the ERC-4337 packed UserOperation ready for submission to the bundler. */
  getPackedUserOp(): PackedUserOperation {
    return this.packUserOp(this.getUserOp());
  }

  /** Returns the UserOperation hash (domain-separated) that signers must sign. */
  getUserOpHash(): string {
    const defaultAbiCoder = ethers.AbiCoder.defaultAbiCoder();
    const packed = this.getPackedUserOp();

    // 1. PACKED_USEROP_TYPEHASH (EntryPoint v0.9)
    const PACKED_USEROP_TYPEHASH = ethers.keccak256(
      ethers.toUtf8Bytes(
        "PackedUserOperation(address sender,uint256 nonce,bytes initCode,bytes callData,bytes32 accountGasLimits,uint256 preVerificationGas,bytes32 gasFees,bytes paymasterAndData)"
      )
    );

    // 2. Struct hash (includes TypeHash as first param)
    const structHash = ethers.keccak256(
      defaultAbiCoder.encode(
        ["bytes32", "address", "uint256", "bytes32", "bytes32", "bytes32", "uint256", "bytes32", "bytes32"],
        [
          PACKED_USEROP_TYPEHASH,
          packed.sender,
          packed.nonce,
          ethers.keccak256(packed.initCode),
          ethers.keccak256(packed.callData),
          packed.accountGasLimits,
          packed.preVerificationGas,
          packed.gasFees,
          ethers.keccak256(packed.paymasterAndData),
        ]
      )
    );

    // 3. EIP-712 Domain Separator (name="ERC4337", version="1")
    const EIP712_DOMAIN_TYPEHASH = ethers.keccak256(
      ethers.toUtf8Bytes(
        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
      )
    );
    const domainSeparator = ethers.keccak256(
      defaultAbiCoder.encode(
        ["bytes32", "bytes32", "bytes32", "uint256", "address"],
        [
          EIP712_DOMAIN_TYPEHASH,
          ethers.keccak256(ethers.toUtf8Bytes("ERC4337")),
          ethers.keccak256(ethers.toUtf8Bytes("1")),
          this.chainId,
          this.entryPoint,
        ]
      )
    );

    // 4. EIP-712 final hash
    return ethers.keccak256(
      ethers.solidityPacked(
        ["bytes1", "bytes1", "bytes32", "bytes32"],
        ["0x19", "0x01", domainSeparator, structHash]
      )
    );
  }

  /**
   * Estimates the gas cost of a UserOperation.
   * Uses the EntryPoint's simulateValidation and simulateHandleOp to estimate gas.
   * @experimental This method has not been fully validated.
   * @note In ERC-4337 v0.7, simulateValidation responds with a ValidationResult revert,
   *       so estimateGas-based verification gas estimation does not work in practice.
   *       Test before using.
   * @param userOp The UserOperation to estimate
   * @returns Estimated gas cost (in wei)
   */
  async estimateUserOpGasCost(userOp: UserOperation): Promise<string> {

    if (!this.provider) {
      throw new AaOperationError({
        code: AaOperationErrorCode.STATE_MISSING_DEPENDENCY,
        operation: "estimate_user_op_gas_cost",
        message: "Provider is required for gas estimation",
      });
    }

    try {
      // 1. Calculate preVerificationGas
      const preVerificationGas = this.calculatePreVerificationGas(userOp);

      // 2. Estimate verificationGasLimit
      const verificationGasLimit = await this.estimateVerificationGas(userOp);

      // 3. Estimate callGasLimit
      const callGasLimit = await this.estimateCallGas(userOp);

      // 4. Estimate paymaster gas (if paymaster is set)
      let paymasterVerificationGasLimit = BigInt(0);
      let paymasterPostOpGasLimit = BigInt(0);

      if (userOp.paymaster && userOp.paymaster !== ethers.ZeroAddress) {
        const paymasterGas = await this.estimatePaymasterGas(userOp);
        paymasterVerificationGasLimit = paymasterGas.verification;
        paymasterPostOpGasLimit = paymasterGas.postOp;
      }

      // 5. Calculate total gas
      const totalGas =
        preVerificationGas +
        verificationGasLimit +
        callGasLimit +
        paymasterVerificationGasLimit +
        paymasterPostOpGasLimit;

      // 6. Get gas price
      const feeData = await this.provider.getFeeData();
      const gasPrice = feeData.gasPrice ?? feeData.maxFeePerGas ?? BigInt(0);
      if (gasPrice === BigInt(0)) {

      }

      // 7. Calculate total cost (gas * gas price)
      const totalCost = totalGas * gasPrice;

      return totalCost.toString();
    } catch (error) {
      throw new AaFetchError({
        code: AaFetchErrorCode.TRANSPORT,
        operation: "estimate_user_op_gas_cost",
        service: "rpc",
        method: "POST",
        cause: error,
        message: `Failed to estimate gas cost: ${error instanceof Error ? error.message : error}`,
      });
    }
  }

  /**
   * Calculates preVerificationGas.
   * @param userOp UserOperation
   * @returns preVerificationGas
   */
  protected calculatePreVerificationGas(userOp: UserOperation): bigint {
    // Base preVerificationGas (accounting for ZK proof signature overhead)
    let preVerificationGas = BigInt(30000);

    // handleOps() ABI encoding overhead (function selector 4B + array offset/length 64B + beneficiary 32B + struct overhead)
    const HANDLE_OPS_OVERHEAD_GAS = BigInt(2000);
    preVerificationGas += HANDLE_OPS_OVERHEAD_GAS;

    // Add calldata cost
    const packedUserOp = this.packUserOp(userOp);
    const encodedUserOp = this.encodeUserOp(packedUserOp, false);
    // EIP-2028: zero byte = 4 gas, non-zero byte = 16 gas
    const encodedBytes = ethers.getBytes(encodedUserOp);
    let calldataCost = BigInt(0);
    for (const byte of encodedBytes) {
      calldataCost += byte === 0 ? BigInt(4) : BigInt(16);
    }
    calldataCost = calldataCost * BigInt(130) / BigInt(100); // 30% buffer for ZK proof calldata
    preVerificationGas += calldataCost;

    return preVerificationGas;
  }

  /**
   * Estimates verificationGasLimit.
   * @param userOp UserOperation
   * @returns verificationGasLimit
   */
  private async estimateVerificationGas(
    userOp: UserOperation
  ): Promise<bigint> {
    /* istanbul ignore next */
    if (!this.provider) {
      throw new AaOperationError({
        code: AaOperationErrorCode.STATE_MISSING_DEPENDENCY,
        operation: "estimate_verification_gas",
        message: "Provider is required for verification gas estimation",
      });
    }

    try {
      // Call EntryPoint's simulateValidation
      const entryPointInterface = new ethers.Interface([
        "function simulateValidation((address,uint256,bytes,bytes,bytes32,uint256,bytes32,bytes,bytes)) external",
      ]);

      const packed = this.packUserOp(userOp);
      const packedArray = [
        packed.sender,
        packed.nonce,
        packed.initCode,
        packed.callData,
        packed.accountGasLimits,
        packed.preVerificationGas,
        packed.gasFees,
        packed.paymasterAndData,
        packed.signature,
      ];
      const callData = entryPointInterface.encodeFunctionData(
        "simulateValidation",
        [packedArray]
      );

      /* istanbul ignore next */
      const gasEstimate = await this.estimateGasWithCap({
        to: this.entryPoint,
        data: callData,
      });

      // Add 20% buffer
      /* istanbul ignore next */
      return (gasEstimate * BaseAccountBuilder.GAS_ESTIMATE_MULTIPLIER) / BaseAccountBuilder.GAS_ESTIMATE_DIVISOR;
    } catch (error) {
      throw new AaFetchError({
        code: AaFetchErrorCode.TRANSPORT,
        operation: "estimate_verification_gas",
        service: "rpc",
        method: "POST",
        cause: error,
        message: `Verification gas estimation failed: ${error instanceof Error ? error.message : error}`,
      });
    }
  }

  /**
   * Estimates callGasLimit.
   * @param userOp UserOperation
   * @returns callGasLimit
   */
  private async estimateCallGas(userOp: UserOperation): Promise<bigint> {
    /* istanbul ignore next */
    if (!this.provider) {
      throw new AaOperationError({
        code: AaOperationErrorCode.STATE_MISSING_DEPENDENCY,
        operation: "estimate_call_gas",
        message: "Provider is required for call gas estimation",
      });
    }

    try {
      // Only estimate if callData is present
      if (!userOp.callData || userOp.callData === "0x") {
        return BigInt(0);
      }

      // Call EntryPoint's simulateHandleOp
      const entryPointInterface = new ethers.Interface([
        "function simulateHandleOp((address,uint256,bytes,bytes,bytes32,uint256,bytes32,bytes,bytes),address,bytes) external",
      ]);

      const packed = this.packUserOp(userOp);
      const packedArray = [
        packed.sender,
        packed.nonce,
        packed.initCode,
        packed.callData,
        packed.accountGasLimits,
        packed.preVerificationGas,
        packed.gasFees,
        packed.paymasterAndData,
        packed.signature,
      ];
      const callData = entryPointInterface.encodeFunctionData(
        "simulateHandleOp",
        [packedArray, userOp.sender, "0x"]
      );

      /* istanbul ignore next */
      const gasEstimate = await this.estimateGasWithCap({
        to: this.entryPoint,
        data: callData,
      });

      // Add 20% buffer
      /* istanbul ignore next */
      return (gasEstimate * BaseAccountBuilder.GAS_ESTIMATE_MULTIPLIER) / BaseAccountBuilder.GAS_ESTIMATE_DIVISOR;
    } catch (error) {
      /* istanbul ignore next */
      throw new AaFetchError({
        code: AaFetchErrorCode.TRANSPORT,
        operation: "estimate_call_gas",
        service: "rpc",
        method: "POST",
        cause: error,
        message: `Call gas estimation failed: ${error instanceof Error ? error.message : error}`,
      });
    }
  }

  /**
   * Estimates paymaster gas.
   * @param userOp UserOperation
   * @returns Paymaster gas information
   */
  private async estimatePaymasterGas(userOp: UserOperation): Promise<{
    verification: bigint;
    postOp: bigint;
  }> {
    /* istanbul ignore next */
    if (!this.provider || !userOp.paymaster) {
      return { verification: BigInt(0), postOp: BigInt(0) };
    }

    try {
      // Call paymaster's validatePaymasterUserOp
      const paymasterInterface = new ethers.Interface([
        "function validatePaymasterUserOp((address,uint256,bytes,bytes,bytes32,uint256,bytes32,bytes,bytes),bytes32,uint256) external returns (bytes memory, uint256)",
      ]);

      const packed = this.packUserOp(userOp);
      const packedArray = [
        packed.sender,
        packed.nonce,
        packed.initCode,
        packed.callData,
        packed.accountGasLimits,
        packed.preVerificationGas,
        packed.gasFees,
        packed.paymasterAndData,
        packed.signature,
      ];
      const defaultAbiCoder = ethers.AbiCoder.defaultAbiCoder();
      const innerHash = ethers.keccak256(
        this.encodeUserOp(packed, true)
      );
      const userOpHash = ethers.keccak256(
        defaultAbiCoder.encode(
          ["bytes32", "address", "uint256"],
          [innerHash, this.entryPoint, this.chainId]
        )
      );
      const callData = paymasterInterface.encodeFunctionData(
        "validatePaymasterUserOp",
        [packedArray, userOpHash, BigInt(0)]
      );

      /* istanbul ignore next */
      const gasEstimate = await this.estimateGasWithCap({
        to: userOp.paymaster,
        data: callData,
      });

      // Add 20% buffer
      /* istanbul ignore next */
      const verificationGas = (gasEstimate * BaseAccountBuilder.GAS_ESTIMATE_MULTIPLIER) / BaseAccountBuilder.GAS_ESTIMATE_DIVISOR;

      // postOp gas is generally a small value
      /* istanbul ignore next */
      const postOpGas = BaseAccountBuilder.DEFAULT_PAYMASTER_POST_OP_GAS;

      /* istanbul ignore next */
      return {
        verification: verificationGas,
        postOp: postOpGas,
      };
    /* istanbul ignore next */
    } catch (error) {
      throw new AaFetchError({
        code: AaFetchErrorCode.TRANSPORT,
        operation: "estimate_paymaster_gas",
        service: "rpc",
        method: "POST",
        cause: error,
        message: `Paymaster gas estimation failed: ${error instanceof Error ? error.message : error}`,
      });
    }
  }

}
