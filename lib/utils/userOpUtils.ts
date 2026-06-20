import { ethers } from "ethers";
import type { UserOperation, PackedUserOperation, PimlicoUserOperation } from "../types/UserOperation";
import { AaOperationError, AaOperationErrorCode } from "../errors";

// ---------------------------------------------------------------------------
// Pack / Unpack UserOperation
// ---------------------------------------------------------------------------

function padTo16Bytes(hex: string): string {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  return clean.padStart(32, "0"); // 16 bytes = 32 hex chars
}

/** Strip leading zeros from a hex string to produce minimal encoding (JSON-RPC convention). */
function toMinimalHex(hex: string): string {
  const stripped = hex.replace(/^0x0+/, "0x");
  return stripped === "0x" ? "0x0" : stripped;
}

/**
 * Pack a UserOperation (unpacked SDK format) into a PackedUserOperation (on-chain format).
 * accountGasLimits = verificationGasLimit (16 bytes) || callGasLimit (16 bytes)
 * gasFees          = maxPriorityFeePerGas (16 bytes) || maxFeePerGas (16 bytes)
 * paymasterAndData = paymaster (20 bytes) || pmVerGasLimit (16 bytes) || pmPostOpGasLimit (16 bytes) || paymasterData
 */
export function packUserOperation(userOp: UserOperation): PackedUserOperation {
  const verificationGasLimit = padTo16Bytes(userOp.verificationGasLimit);
  const callGasLimit = padTo16Bytes(userOp.callGasLimit);
  const accountGasLimits = "0x" + verificationGasLimit + callGasLimit;

  const maxPriorityFeePerGas = padTo16Bytes(userOp.maxPriorityFeePerGas);
  const maxFeePerGas = padTo16Bytes(userOp.maxFeePerGas);
  const gasFees = "0x" + maxPriorityFeePerGas + maxFeePerGas;

  let paymasterAndData = "0x";
  const paymaster = userOp.paymaster || ethers.ZeroAddress;
  if (paymaster !== "0x" && paymaster !== ethers.ZeroAddress) {
    const paymasterClean = paymaster.startsWith("0x") ? paymaster.slice(2) : paymaster;
    const pmVerGas = padTo16Bytes(userOp.paymasterVerificationGasLimit || "0x0");
    const pmPostGas = padTo16Bytes(userOp.paymasterPostOpGasLimit || "0x0");
    const pmData = (userOp.paymasterData || "0x").startsWith("0x")
      ? (userOp.paymasterData || "0x").slice(2)
      : (userOp.paymasterData || "");
    paymasterAndData = "0x" + paymasterClean + pmVerGas + pmPostGas + pmData;
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

/**
 * Unpack a PackedUserOperation back into the SDK UserOperation format.
 */
export function unpackUserOperation(packed: PackedUserOperation): UserOperation {
  // accountGasLimits: bytes32 = verificationGasLimit (16 bytes) || callGasLimit (16 bytes)
  const agl = packed.accountGasLimits.replace("0x", "").padStart(64, "0");
  const verificationGasLimit = "0x" + agl.slice(0, 32);
  const callGasLimit = "0x" + agl.slice(32, 64);

  // gasFees: bytes32 = maxPriorityFeePerGas (16 bytes) || maxFeePerGas (16 bytes)
  const gf = packed.gasFees.replace("0x", "").padStart(64, "0");
  const maxPriorityFeePerGas = "0x" + gf.slice(0, 32);
  const maxFeePerGas = "0x" + gf.slice(32, 64);

  // paymasterAndData: paymaster (20 bytes / 40 hex) || pmVerGas (16 bytes / 32 hex) || pmPostGas (16 bytes / 32 hex) || data
  let paymaster = ethers.ZeroAddress;
  let paymasterVerificationGasLimit = "0x0";
  let paymasterPostOpGasLimit = "0x0";
  let paymasterData = "0x";

  const pad = packed.paymasterAndData.replace("0x", "");
  if (pad.length >= 40) {
    paymaster = "0x" + pad.slice(0, 40);
    if (pad.length >= 40 + 64) {
      paymasterVerificationGasLimit = "0x" + pad.slice(40, 40 + 32);
      paymasterPostOpGasLimit = "0x" + pad.slice(40 + 32, 40 + 64);
      paymasterData = pad.length > 40 + 64 ? "0x" + pad.slice(40 + 64) : "0x";
    }
  }

  return {
    sender: packed.sender,
    nonce: packed.nonce,
    initCode: packed.initCode,
    callData: packed.callData,
    callGasLimit,
    verificationGasLimit,
    preVerificationGas: packed.preVerificationGas,
    maxFeePerGas,
    maxPriorityFeePerGas,
    paymaster,
    paymasterData,
    paymasterVerificationGasLimit,
    paymasterPostOpGasLimit,
    signature: packed.signature,
  };
}

/**
 * Convert a PackedUserOperation to Pimlico v0.7/v0.8 JSON-RPC format.
 *
 * Pimlico bundlers expect an unpacked format with separate `factory` and `factoryData`
 * fields instead of the combined `initCode` field used in the on-chain packed format.
 *
 * @param packed - The packed UserOperation (on-chain format)
 * @returns The UserOperation in Pimlico JSON-RPC format
 *
 * @example
 * ```ts
 * const packed = packUserOperation(userOp);
 * const pimlicoFormat = toPimlicoFormat(packed);
 * // Submit to Pimlico bundler
 * await fetch(pimlicoUrl, {
 *   method: 'POST',
 *   body: JSON.stringify({
 *     jsonrpc: '2.0',
 *     method: 'eth_sendUserOperation',
 *     params: [pimlicoFormat, entryPoint],
 *   }),
 * });
 * ```
 */
export function toPimlicoFormat(packed: PackedUserOperation): PimlicoUserOperation {
  const unpacked = unpackUserOperation(packed);

  // Validate and split initCode into factory (20 bytes) and factoryData (rest)
  let factory: string | undefined;
  let factoryData: string | undefined;
  const initCode = unpacked.initCode;
  if (initCode && initCode !== "0x") {
    if (initCode.length < 42) {
      throw new AaOperationError({
        code: AaOperationErrorCode.INPUT_INVALID_FORMAT,
        operation: "to_pimlico_format",
        message: `Invalid initCode: expected at least 20-byte address (42 hex chars with 0x prefix), got ${initCode.length} chars`,
      });
    }
    factory = "0x" + initCode.slice(2, 42);
    factoryData = initCode.length > 42 ? "0x" + initCode.slice(42) : "0x";
  }

  // Validate paymasterAndData: if paymaster is present, gas fields must also be present
  const paymasterHex = packed.paymasterAndData.replace("0x", "");
  const hasPaymaster =
    unpacked.paymaster &&
    unpacked.paymaster !== "0x" &&
    unpacked.paymaster.toLowerCase() !== ethers.ZeroAddress;
  if (hasPaymaster && paymasterHex.length < 104) {
    throw new AaOperationError({
      code: AaOperationErrorCode.INPUT_INVALID_FORMAT,
      operation: "to_pimlico_format",
      message: `Invalid paymasterAndData: has paymaster address but missing gas fields (expected ≥104 hex chars, got ${paymasterHex.length})`,
    });
  }

  const result: PimlicoUserOperation = {
    sender: unpacked.sender,
    nonce: toMinimalHex(unpacked.nonce),
    callData: unpacked.callData,
    callGasLimit: toMinimalHex(unpacked.callGasLimit),
    verificationGasLimit: toMinimalHex(unpacked.verificationGasLimit),
    preVerificationGas: toMinimalHex(unpacked.preVerificationGas),
    maxFeePerGas: toMinimalHex(unpacked.maxFeePerGas),
    maxPriorityFeePerGas: toMinimalHex(unpacked.maxPriorityFeePerGas),
    signature: unpacked.signature,
  };

  // Add factory fields only if deploying
  if (factory) {
    result.factory = factory;
    result.factoryData = factoryData;
  }

  // Add paymaster fields only if using paymaster
  if (hasPaymaster) {
    result.paymaster = unpacked.paymaster;
    result.paymasterVerificationGasLimit = toMinimalHex(unpacked.paymasterVerificationGasLimit);
    result.paymasterPostOpGasLimit = toMinimalHex(unpacked.paymasterPostOpGasLimit);
    result.paymasterData = unpacked.paymasterData;
  }

  return result;
}

// ---------------------------------------------------------------------------
// Dummy signatures (for gas estimation before autoFillUserOp)
// ---------------------------------------------------------------------------

const MAX = ethers.MaxUint256;
const DUMMY_PROOF_8: bigint[] = [MAX, MAX, MAX, MAX, MAX, MAX, MAX, MAX];

/**
 * Create a dummy ZK signature for gas estimation.
 * @param n - 1 for 1-of-1 (deploy signature), 3 for 3-of-3 (recovery / updateKeys)
 * @returns ABI-encoded dummy ZK proof string (the keySignatureList entry)
 */
export function createDummyZkSignature(n: number): string {
  const count = n >= 3 ? 3 : 1;
  return ethers.AbiCoder.defaultAbiCoder().encode(
    ["uint256[6]", "uint256[]", "uint256[]", "uint256[8][]"],
    [
      [MAX, MAX, MAX, MAX, MAX, MAX],
      Array.from({ length: count }, () => MAX),
      Array.from({ length: count }, () => MAX),
      Array.from({ length: count }, () => DUMMY_PROOF_8),
    ]
  );
}

/**
 * Create a dummy passkey (WebAuthn) signature for gas estimation.
 * Matches the 7-field ABI encoding in PasskeySigner.signUserOpHash():
 * (authenticatorData, clientDataJSON, signature, typeIndex, challengeIndex, originIndex, originLength)
 * @returns ABI-encoded dummy passkey signature string (the keySignatureList entry)
 */
export function createDummyPasskeySignature(): string {
  return ethers.AbiCoder.defaultAbiCoder().encode(
    ["bytes", "bytes", "bytes", "uint256", "uint256", "uint256", "uint256"],
    [
      ethers.randomBytes(37),  // authenticatorData (typical WebAuthn size)
      ethers.randomBytes(200), // clientDataJSON
      ethers.randomBytes(72),  // DER-encoded secp256r1 signature
      ethers.MaxUint256,       // typeIndex
      ethers.MaxUint256,       // challengeIndex
      ethers.MaxUint256,       // originIndex (originStart)
      ethers.MaxUint256,       // originLength
    ]
  );
}
