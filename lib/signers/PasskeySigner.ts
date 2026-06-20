import { base64URLdecode, toURLEncode } from "../utils/base64url";
import { IUserOpSigner } from "../utils/IUserOpSigner";
import { AaOperationError, AaOperationErrorCode } from "../errors";
import {
  unwrapSignature,
  flipSecp256r1Signature,
  wrapSignature,
} from "../utils/signature";
import { ethers } from "ethers";
import { PrimitiveAccountKeyTypes } from "../types/AccountKey";

function findSubarray(haystack: Uint8Array, needle: Uint8Array): number {
  if (needle.length === 0 || haystack.length < needle.length) return -1;
  const maxStart = haystack.length - needle.length;
  for (let i = 0; i <= maxStart; i++) {
    let matched = true;
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) {
        matched = false;
        break;
      }
    }
    if (matched) return i;
  }
  return -1;
}

function findByte(bytes: Uint8Array, value: number, fromIndex: number): number {
  for (let i = fromIndex; i < bytes.length; i++) {
    if (bytes[i] === value) return i;
  }
  return -1;
}

/**
 * Signs UserOperation hashes using a WebAuthn passkey (secp256r1 / P-256 ECDSA).
 *
 * This signer bridges the browser WebAuthn API and the on-chain WebAuthn verifier.
 * It encodes the authenticator response (signature, authenticatorData, clientDataJSON)
 * into the ABI format expected by the ZKAP account contract.
 *
 * @example
 * ```ts
 * const signer = new PasskeySigner(credentialId, async (id, challenge) => {
 *   const assertion = await navigator.credentials.get({
 *     publicKey: { challenge: base64url.decode(challenge), allowCredentials: [{ id, type: "public-key" }] },
 *   });
 *   return { response: assertion.response };
 * });
 * const signatures = await signer.signUserOpHash(userOpHash);
 * ```
 */
export class PasskeySigner implements IUserOpSigner {
  /**
   * Account key type identifiers handled by this signer.
   * Always `[PrimitiveAccountKeyTypes.keyWebAuthn]`.
   */
  public readonly keyTypes: number[] = [PrimitiveAccountKeyTypes.keyWebAuthn];
  private credentialId: string;
  private verifyWithPasskey: (
    credentialId: string,
    challenge: string
  ) => Promise<{
    response: {
      signature: string;
      authenticatorData: string;
      clientDataJSON: string;
    };
  }>;

  /**
   * Creates a `PasskeySigner` backed by a caller-supplied WebAuthn assertion function.
   *
   * @param credentialId - The base64url-encoded credential ID of the registered passkey.
   * @param verifyWithPasskey - An async function that invokes the WebAuthn `get()` ceremony
   *   and returns the raw authenticator response fields as base64url strings.
   */
  constructor(
    credentialId: string,
    verifyWithPasskey: (
      credentialId: string,
      challenge: string
    ) => Promise<{
      response: {
        signature: string;
        authenticatorData: string;
        clientDataJSON: string;
      };
    }>
  ) {
    this.credentialId = credentialId;
    this.verifyWithPasskey = verifyWithPasskey;
  }

  /**
   * Signs the UserOperation hash via the WebAuthn passkey and returns an ABI-encoded signature.
   *
   * The challenge is derived from the hash and passed to the `verifyWithPasskey` callback.
   * The resulting authenticator response is normalized (low-S), then ABI-encoded with
   * the field offsets required by the on-chain WebAuthn verifier.
   *
   * @param userOpHash - The 32-byte hex hash of the packed UserOperation.
   * @returns A single-element array containing the ABI-encoded WebAuthn signature payload.
   * @throws If the authenticator response is missing required fields (`type`, `challenge`, `origin`).
   */
  async signUserOpHash(userOpHash: string): Promise<string[]> {
    // raw 32 bytes → base64URL (matches contract's Base64.encodeURL(abi.encodePacked(bytes32(msgHash))))
    const challenge = toURLEncode(ethers.encodeBase64(ethers.getBytes(userOpHash)));
    const authResp = await this.verifyWithPasskey(
      this.credentialId,
      challenge
    );

    const [r, s] = unwrapSignature(
      base64URLdecode(authResp.response.signature)
    );
    const [newR, newS] = flipSecp256r1Signature(r, s);
    const newSig = wrapSignature(newR, newS);

    const clientJsonBytes = base64URLdecode(authResp.response.clientDataJSON);
    const encoder = new TextEncoder();

    const typeKey = encoder.encode('"type":"');
    const typeKeyOffset = findSubarray(clientJsonBytes, typeKey);
    if (typeKeyOffset < 0) {
      throw new AaOperationError({
        code: AaOperationErrorCode.SIGNER_KEY_INVALID,
        operation: "sign_user_op_hash",
        message: 'signUserOpHash: clientDataJSON missing "type" field',
      });
    }
    const typeIndex = typeKeyOffset + typeKey.byteLength;

    const challengeKey = encoder.encode('"challenge":"');
    const challengeKeyOffset = findSubarray(clientJsonBytes, challengeKey);
    if (challengeKeyOffset < 0) {
      throw new AaOperationError({
        code: AaOperationErrorCode.SIGNER_KEY_INVALID,
        operation: "sign_user_op_hash",
        message: 'signUserOpHash: clientDataJSON missing "challenge" field',
      });
    }
    const challengeIndex = challengeKeyOffset + challengeKey.byteLength;

    const originKey = encoder.encode('"origin":"');
    const originKeyOffset = findSubarray(clientJsonBytes, originKey);
    if (originKeyOffset < 0) {
      throw new AaOperationError({
        code: AaOperationErrorCode.SIGNER_KEY_INVALID,
        operation: "sign_user_op_hash",
        message: 'signUserOpHash: clientDataJSON missing "origin" field',
      });
    }
    const originIndex = originKeyOffset + originKey.byteLength;
    const originEnd = findByte(clientJsonBytes, 0x22, originIndex); // 0x22 = '"'
    if (originEnd < 0) {
      throw new AaOperationError({
        code: AaOperationErrorCode.SIGNER_KEY_INVALID,
        operation: "sign_user_op_hash",
        message: 'signUserOpHash: clientDataJSON "origin" value not terminated',
      });
    }
    const originLength = originEnd - originIndex;

    const abiCoder = ethers.AbiCoder.defaultAbiCoder();
    const encodedSignature = abiCoder.encode(
      ["bytes", "bytes", "bytes", "uint256", "uint256", "uint256", "uint256"],
      [
        ethers.hexlify(base64URLdecode(authResp.response.authenticatorData)),
        ethers.hexlify(clientJsonBytes),
        ethers.hexlify(newSig),
        typeIndex,
        challengeIndex,
        originIndex,
        originLength,
      ]
    );

    return [encodedSignature];
  }
}
