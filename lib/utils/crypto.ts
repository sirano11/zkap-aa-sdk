import { ethers } from "ethers";

import { AaOperationError, AaOperationErrorCode } from "../errors";

export const BN254_FR =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const MODULUS_BIT_SIZE = 254;
const LIMB_WIDTH = Math.floor((MODULUS_BIT_SIZE - 1) / 8); // = 31

// NOTE: This is a custom SHA-256 block compression for ZK circuit intermediate state computation, not a general-purpose hash. Cannot be replaced by ethers.sha256.
function sha256BlockCompress(data: Uint8Array): number[] {
  if (data.length % 64 !== 0) {
    throw new AaOperationError({
      code: AaOperationErrorCode.CRYPTO_INVALID_LENGTH,
      operation: "sha256_block_compress",
      message: "data length must be a multiple of 64 bytes",
    });
  }

  // Start with initial hash values
  let state = INITIAL_HASH_VALUE;

  // Process data in 64-byte chunks and update state
  for (let i = 0; i < data.length; i += 64) {
    const chunk = data.slice(i, i + 64);
    state = sha256BlockCompressWithState(state, chunk);
  }

  return state;
}

function getOutOfCircuitHashSegment(jwt: string, keys: string[]): string {
  if (keys.length === 0) {
    throw new AaOperationError({
      code: AaOperationErrorCode.INPUT_OUT_OF_RANGE,
      operation: "get_out_of_circuit_hash_segment",
      message: "getOutOfCircuitHashSegment: keys must be a non-empty array",
    });
  }
  const hashBlockSize = 64; // 512 bits

  // Split JWT by '.' delimiter (header, payload, signature)
  const parts = jwt.split(".");
  if (parts.length !== 3) {
    throw new AaOperationError({
      code: AaOperationErrorCode.SIGNER_JWT_INVALID,
      operation: "get_out_of_circuit_hash_segment",
      message: "Invalid JWT: must contain header, payload, and signature",
    });
  }
  const [headerB64, payloadB64] = parts;

  // payOffsetB64 is header length + 1
  const payOffsetB64 = headerB64.length + 1;
  // Perform URL-safe Base64 decoding to produce the payload string
  const payload = base64urlToUtf8(payloadB64);

  const minOffset = Math.min(
    ...keys.map((key) => getValueOffsetFromKey(payload, key))
  );

  const minOffsetB64 = Math.floor(minOffset / 3) * 4;

  // Calculate final outOfCircuitHashLen: floor((payOffsetB64 + minOffsetB64) / hashBlockSize) * hashBlockSize
  const outOfCircuitHashLen =
    Math.floor((payOffsetB64 + minOffsetB64) / hashBlockSize) * hashBlockSize;
  return jwt.slice(0, outOfCircuitHashLen);
}

function base64urlToUtf8(base64url: string): string {
  // base64url → base64
  const base64 =
    base64url.replace(/-/g, "+").replace(/_/g, "/") +
    "=".repeat((4 - (base64url.length % 4)) % 4);

  // base64 decode → UTF-8 string
  return Buffer.from(base64, "base64").toString("utf8");
}

function Utf8ToUint8Array(utf8: string): Uint8Array {
  const encoder = new TextEncoder();
  return encoder.encode(utf8);
}

// 32-bit right rotation
// Rotate x right by n bits
const rotateRight = (x: number, n: number): number =>
  ((x >>> n) | (x << (32 - n))) >>> 0;

// NOTE: This is a custom SHA-256 block compression for ZK circuit intermediate state computation, not a general-purpose hash. Cannot be replaced by ethers.sha256.
function sha256BlockCompressWithState(state: number[], data: Uint8Array) {
  /* istanbul ignore next */
  if (data.length !== 64) {
    throw new AaOperationError({
      code: AaOperationErrorCode.CRYPTO_INVALID_LENGTH,
      operation: "sha256_block_compress_with_state",
      message: "data length must be 64 bytes",
    });
  }

  const w = new Uint32Array(64);

  // Prepare message schedule: read 4 bytes at a time in big-endian format
  for (let i = 0; i < 16; i++) {
    const j = i * 4;
    w[i] =
      ((data[j] << 24) |
        (data[j + 1] << 16) |
        (data[j + 2] << 8) |
        data[j + 3]) >>>
      0;
  }

  // Extend message schedule
  for (let i = 16; i < 64; i++) {
    const s0 =
      (rotateRight(w[i - 15], 7) ^
        rotateRight(w[i - 15], 18) ^
        (w[i - 15] >>> 3)) >>>
      0;
    const s1 =
      (rotateRight(w[i - 2], 17) ^
        rotateRight(w[i - 2], 19) ^
        (w[i - 2] >>> 10)) >>>
      0;
    w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
  }

  // Initialize working variables
  let [a, b, c, d, e, f, g, h] = state;

  // Main compression loop
  for (let i = 0; i < 64; i++) {
    const s1 =
      (rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25)) >>> 0;
    const ch = ((e & f) ^ (~e & g)) >>> 0;
    const temp1 = (h + s1 + ch + K[i] + w[i]) >>> 0;
    const s0 =
      (rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22)) >>> 0;
    const maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
    const temp2 = (s0 + maj) >>> 0;

    h = g;
    g = f;
    f = e;
    e = (d + temp1) >>> 0;
    d = c;
    c = b;
    b = a;
    a = (temp1 + temp2) >>> 0;
  }

  // Add compressed result to original state to compute new state
  return [
    (state[0] + a) >>> 0,
    (state[1] + b) >>> 0,
    (state[2] + c) >>> 0,
    (state[3] + d) >>> 0,
    (state[4] + e) >>> 0,
    (state[5] + f) >>> 0,
    (state[6] + g) >>> 0,
    (state[7] + h) >>> 0,
  ];
}

function getValueOffsetFromKey(payload: string, key: string): number {
  // Regex pattern to find the claim corresponding to the key.
  // The pattern captures "key" followed by optional whitespace, colon, optional whitespace,
  // and the value (including surrounding quotes if present, or up to whitespace, comma, or '}').
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regexPattern = new RegExp(
    `"${escapedKey}"\\s*:\\s*(?<value>"[^"]*"|[^\\s,\\}]+)`
  );

  const match = regexPattern.exec(payload);
  if (!match) {
    throw new AaOperationError({
      code: AaOperationErrorCode.CRYPTO_CLAIM_NOT_FOUND,
      operation: "get_value_offset_from_key",
      message: `Claim with key "${key}" not found in payload`,
    });
  }

  // match[0] is the full matched string; match.groups?.value is the named capture group (value).
  const fullMatch = match[0];
  const valuePart = match.groups?.value;
  if (!valuePart) {
    throw new AaOperationError({
      code: AaOperationErrorCode.CRYPTO_CLAIM_NOT_FOUND,
      operation: "get_value_offset_from_key",
      message: `Value part not found in the matched string for key "${key}"`,
    });
  }

  // Calculate the index at which valuePart starts within the full matched string.
  const indexInMatch = fullMatch.indexOf(valuePart);

  // The offset in the full payload is the sum of the match start index (match.index) and the inner index of valuePart (indexInMatch).
  return (match.index /* istanbul ignore next */ ?? 0) + indexInMatch;
}

const INITIAL_HASH_VALUE = [
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
  0x1f83d9ab, 0x5be0cd19,
];

const K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

function commonVkParser(
  commonVk: string[]
): [string[][], string, string, string, string] {
  const g1Generator = [commonVk[0], commonVk[1]];
  const g2Generator = [commonVk[3], commonVk[2], commonVk[5], commonVk[4]];
  const g2X = [commonVk[7], commonVk[6], commonVk[9], commonVk[8]];
  const g1Z = [commonVk[10], commonVk[11]];
  const g2Z = [commonVk[13], commonVk[12], commonVk[15], commonVk[14]];

  const pairingVk = [g1Generator, g2Generator, g2X, g1Z, g2Z];

  const n = commonVk[16];
  const m0 = commonVk[17];
  const sigma = commonVk[18];
  const omega = commonVk[19];

  const verifyingKeyBase: [string[][], string, string, string, string] = [
    pairingVk,
    n,
    m0,
    sigma,
    omega,
  ];
  return verifyingKeyBase;
}

function getSignedMessageHash(message: string): string {
  const signedMessage = ethers.keccak256(
    ethers.concat([
      ethers.toUtf8Bytes("\x19Ethereum Signed Message:\n32"),
      ethers.getBytes(message),
    ])
  );

  return signedMessage;
}

function userSpecificVkParser(userVk: string[] | bigint[]): bigint[][] {
  if (userVk.length !== 16) {
    throw new AaOperationError({
      code: AaOperationErrorCode.CRYPTO_INVALID_LENGTH,
      operation: "user_specific_vk_parser",
      message: "userVk length must be 16",
    });
  }

  const g2Mu = [
    BigInt(userVk[1].toString()),
    BigInt(userVk[0].toString()),
    BigInt(userVk[3].toString()),
    BigInt(userVk[2].toString()),
  ];

  const g2MuX = [
    BigInt(userVk[5].toString()),
    BigInt(userVk[4].toString()),
    BigInt(userVk[7].toString()),
    BigInt(userVk[6].toString()),
  ];

  const g2MuZ = [
    BigInt(userVk[9].toString()),
    BigInt(userVk[8].toString()),
    BigInt(userVk[11].toString()),
    BigInt(userVk[10].toString()),
  ];

  const vAcc = [
    BigInt(userVk[13].toString()),
    BigInt(userVk[12].toString()),
    BigInt(userVk[15].toString()),
    BigInt(userVk[14].toString()),
  ];

  const userSpecificVk = [g2Mu, g2MuX, g2MuZ, vAcc];

  return userSpecificVk;
}

function userSpecificVkToStringArray(userSpecificVk: bigint[][]): string[] {
  if (userSpecificVk.length !== 4) {
    throw new AaOperationError({
      code: AaOperationErrorCode.CRYPTO_INVALID_LENGTH,
      operation: "user_specific_vk_to_string_array",
      message: "userSpecificVk must have 4 elements",
    });
  }

  const [g2Mu, g2MuX, g2MuZ, vAcc] = userSpecificVk;

  // Verify each array has exactly 4 elements
  if (
    g2Mu.length !== 4 ||
    g2MuX.length !== 4 ||
    g2MuZ.length !== 4 ||
    vAcc.length !== 4
  ) {
    throw new AaOperationError({
      code: AaOperationErrorCode.CRYPTO_INVALID_LENGTH,
      operation: "user_specific_vk_to_string_array",
      message: "Each element in userSpecificVk must have 4 elements",
    });
  }

  // Rearrange back to original order
  return [
    g2Mu[1].toString(),
    g2Mu[0].toString(),
    g2Mu[3].toString(),
    g2Mu[2].toString(),
    g2MuX[1].toString(),
    g2MuX[0].toString(),
    g2MuX[3].toString(),
    g2MuX[2].toString(),
    g2MuZ[1].toString(),
    g2MuZ[0].toString(),
    g2MuZ[3].toString(),
    g2MuZ[2].toString(),
    vAcc[1].toString(),
    vAcc[0].toString(),
    vAcc[3].toString(),
    vAcc[2].toString(),
  ];
}

/**
 * Performs the same logic as Solidity's formattingModulorN function.
 * Reverses the byte array, splits it into 8-byte chunks, and converts
 * to an array of uint256 (bigint) values in little-endian order.
 * @param n Hex string with '0x' prefix or Uint8Array
 * @returns Array of type bigint[]
 */
export function formattingModulorN(n: string | Uint8Array): string[] {
  const bytes = ethers.getBytes(n);
  if (bytes.length % 8 !== 0) {
    throw new AaOperationError({
      code: AaOperationErrorCode.CRYPTO_INVALID_LENGTH,
      operation: "formatting_modulor_n",
      message: "Input length must be a multiple of 8",
    });
  }

  const reversedBytes = bytes.slice().reverse();

  const chunks = reversedBytes.length / 8;
  const result: string[] = [];

  for (let i = 0; i < chunks; i++) {
    const chunk = reversedBytes.slice(i * 8, (i + 1) * 8);

    let value = 0n;

    for (let j = 0; j < 8; j++) {
      value |= BigInt(chunk[j]) << (8n * BigInt(j));
    }

    result.push(ethers.toBeHex(value));
  }

  return result;
}

/**
 * TypeScript port of Rust's calculate_max_claim_len.
 * @param userMaxClaimLen Maximum claim length requested by the user
 * @param modulusBitSize   Modulus bit size of the field (default: BN254)
 * @returns max_claim_len aligned to field limb units
 */
export function calculateMaxClaimLen(
  userMaxClaimLen: number,
  modulusBitSize: number = MODULUS_BIT_SIZE
): number {
  const limbWidth = Math.floor((modulusBitSize - 1) / 8);
  const nLimbs = Math.ceil(userMaxClaimLen / limbWidth);
  const maxClaimLen = nLimbs * limbWidth;
  return maxClaimLen;
}

/**
 * Pads a string to the specified length.
 * @param s The string to pad
 * @param targetLen Target length
 * @param padChar Character code to use for padding (u8 value)
 * @returns Padded string
 */
export function padStr(s: string, targetLen: number, padChar: number): string {
  const len = s.length;

  if (len < targetLen) {
    s += String.fromCharCode(padChar).repeat(targetLen - len);
  }

  return s;
}

/** big-endian bytes -> bigint */
function beBytesToBigInt(bytes: Uint8Array): bigint {
  let x = 0n;
  for (let i = 0; i < bytes.length; i++) x = (x << 8n) + BigInt(bytes[i]);
  return x;
}

/** Equivalent to Rust's F::from_be_bytes_mod_order: splits into 31-byte chunks, reduces mod p */
function strToFieldsBN254(s: string): bigint[] {
  const bytes = new TextEncoder().encode(s);

  /* istanbul ignore next */
  if (bytes.length % LIMB_WIDTH !== 0) {
    throw new AaOperationError({
      code: AaOperationErrorCode.CRYPTO_INVALID_LENGTH,
      operation: "str_to_fields_b_n254",
      message: `Input length (${bytes.length}) must be a multiple of ${LIMB_WIDTH}.`,
    });
  }

  const out: bigint[] = [];
  for (let i = 0; i < bytes.length; i += LIMB_WIDTH) {
    const chunk = bytes.subarray(i, i + LIMB_WIDTH);
    const n = beBytesToBigInt(chunk) % BN254_FR;
    out.push(n);
  }
  return out;
}

export function padAndStrToFieldsBN254(
  s: string,
  userMaxClaimLen: number,
  padChar: number
): bigint[] {
  const maxClaimLen = calculateMaxClaimLen(userMaxClaimLen);

  s = padStr(s, maxClaimLen, padChar);

  return strToFieldsBN254(s);
}

export default {
  sha256BlockCompress,
  getOutOfCircuitHashSegment,
  Utf8ToUint8Array,
  commonVkParser,
  userSpecificVkParser,
  userSpecificVkToStringArray,
  getSignedMessageHash,
  formattingModulorN,
  padAndStrToFieldsBN254,
};
