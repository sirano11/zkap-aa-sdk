import { ethers } from "ethers";

import { AaOperationError, AaOperationErrorCode } from "../errors";

export function unwrapSignature(sigBuffer: Uint8Array) {
  if (sigBuffer.length < 8) {
    throw new AaOperationError({
      code: AaOperationErrorCode.INPUT_INVALID_FORMAT,
      operation: "unwrap_signature",
      message: "DER signature too short",
    });
  }
  if (sigBuffer[0] !== 0x30) {
    throw new AaOperationError({
      code: AaOperationErrorCode.INPUT_INVALID_FORMAT,
      operation: "unwrap_signature",
      message: "Expected DER SEQUENCE tag (0x30)",
    });
  }
  if (sigBuffer[2] !== 0x02) {
    throw new AaOperationError({
      code: AaOperationErrorCode.INPUT_INVALID_FORMAT,
      operation: "unwrap_signature",
      message: "Expected DER INTEGER tag (0x02) for r",
    });
  }
  const rLength = sigBuffer[3];
  if (rLength > sigBuffer.length - 4) {
    throw new AaOperationError({
      code: AaOperationErrorCode.INPUT_INVALID_FORMAT,
      operation: "unwrap_signature",
      message: "Invalid r length in DER signature",
    });
  }
  // Validate s INTEGER tag
  const sTagOffset = 4 + rLength;
  if (sTagOffset + 1 >= sigBuffer.length) {
    throw new AaOperationError({
      code: AaOperationErrorCode.INPUT_INVALID_FORMAT,
      operation: "unwrap_signature",
      message: "DER signature too short for s component",
    });
  }
  if (sigBuffer[sTagOffset] !== 0x02) {
    throw new AaOperationError({
      code: AaOperationErrorCode.INPUT_INVALID_FORMAT,
      operation: "unwrap_signature",
      message: "Expected DER INTEGER tag (0x02) for s",
    });
  }
  const sLength = sigBuffer[sTagOffset + 1];
  if (sTagOffset + 2 + sLength > sigBuffer.length) {
    throw new AaOperationError({
      code: AaOperationErrorCode.INPUT_INVALID_FORMAT,
      operation: "unwrap_signature",
      message: "Invalid s length in DER signature",
    });
  }
  // Right-align r and s to 32 bytes
  // DER may add a leading 0x00 sign byte (when MSB=1) or omit leading zeros,
  // so always right-align into a 32-byte buffer before returning
  const rRaw = sigBuffer.slice(4, 4 + rLength);
  const sRaw = sigBuffer.slice(sTagOffset + 2, sTagOffset + 2 + sLength);
  const r = new Uint8Array(32);
  const s = new Uint8Array(32);
  const rStripped = rLength > 32 ? rRaw.slice(rLength - 32) : rRaw;
  r.set(rStripped, 32 - rStripped.length);
  const sStripped = sLength > 32 ? sRaw.slice(sLength - 32) : sRaw;
  s.set(sStripped, 32 - sStripped.length);

  return [r, s];
}

export function flipSecp256r1Signature(
  r: Uint8Array,
  s: Uint8Array
): Uint8Array[] {
  let bigS = ethers.toBigInt(s);
  const halfN = ethers.toBigInt(
    fromHex("7fffffff800000007fffffffffffffffde737d56d38bcf4279dce5617e3192a8")
  );
  const N = ethers.toBigInt(
    fromHex("FFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551")
  );
  // console.log("halfN", halfN.toString())
  if (bigS > halfN) {
    // console.log("flipping s")
    bigS = N - bigS;
    // Normalize to exactly 32 bytes (left-pad with zeros) to maintain consistent size
    const sBytes = ethers.toBeArray(bigS);
    const sNormalized = new Uint8Array(32);
    sNormalized.set(sBytes, 32 - sBytes.length);
    s = sNormalized;
  }
  return [r, s];
}

export function wrapSignature(r: Uint8Array, s: Uint8Array): Uint8Array {
  // Ensure r and s are padded to 32 bytes (DER INTEGER may drop leading zeros)
  const rPadded = r.length < 32
    ? new Uint8Array([...new Uint8Array(32 - r.length), ...r])
    : r;
  const sPadded = s.length < 32
    ? new Uint8Array([...new Uint8Array(32 - s.length), ...s])
    : s;
  // DER INTEGER requires a 0x00 prefix byte when the MSB is set,
  // to distinguish a positive integer from a negative one (two's complement).
  const rNeedsSign = rPadded[0] >= 0x80;
  const sNeedsSign = sPadded[0] >= 0x80;
  const rIntLen = 32 + (rNeedsSign ? 1 : 0);
  const sIntLen = 32 + (sNeedsSign ? 1 : 0);
  const seqLen = 2 + rIntLen + 2 + sIntLen;
  return Buffer.concat([
    new Uint8Array([0x30, seqLen, 0x02, rIntLen]),
    rNeedsSign ? new Uint8Array([0x00]) : new Uint8Array([]),
    rPadded,
    new Uint8Array([0x02, sIntLen]),
    sNeedsSign ? new Uint8Array([0x00]) : new Uint8Array([]),
    sPadded,
  ]);
}

/**
 * Convert a Uint8Array to Hexadecimal.
 *
 * A replacement for `Buffer.toString('hex')`
 */
export function toHex(array: Uint8Array) {
  const hexParts = Array.from(array, (i) => i.toString(16).padStart(2, "0"));
  // adce000235bcc60a648b0b25f1f05503
  return hexParts.join("");
}
/**
 * Convert a hexadecimal string to isoUint8Array.
 *
 * A replacement for `Buffer.from('...', 'hex')`
 */
export function fromHex(hex: string | null) {
  if (!hex) {
    return Uint8Array.from([]);
  }
  const isValid =
    hex.length !== 0 && hex.length % 2 === 0 && !/[^a-fA-F0-9]/u.test(hex);
  if (!isValid) {
    throw new AaOperationError({
      code: AaOperationErrorCode.INPUT_INVALID_FORMAT,
      operation: "from_hex",
      message: "Invalid hex string",
    });
  }
  /* istanbul ignore next */
  const byteStrings = hex.match(/.{1,2}/g) ?? [];
  return Uint8Array.from(byteStrings.map((byte) => parseInt(byte, 16)));
}
