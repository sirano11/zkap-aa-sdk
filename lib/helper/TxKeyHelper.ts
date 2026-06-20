import { ethers } from "ethers";
import { AccountKeyBuilder } from "../builders/AccountKeyBuilder";
import { AaOperationError, AaOperationErrorCode } from "../errors";
import type { WebAuthnKeyData as BuilderWebAuthnKeyData } from "../types/AccountKey";
import type { TxKeyInfo } from "../reader/AccountReader";

const MAX_TX_KEYS = 5;

/**
 * Parameters for a new WebAuthn key to be added or replaced.
 */
export interface WebAuthnNewKeyParams {
  credentialPubkey: string; // COSE-encoded public key (hex)
  credentialId: string; // base64url credential ID
  rpIdHash: string; // SHA-256 hash of rpId (hex)
  origin: string; // origin string (e.g., "https://zkap.app")
  requireUV?: boolean; // require user verification (default: true)
}

/**
 * Pre-built entry for an existing on-chain key to preserve during updateTxKey.
 * The caller constructs this from on-chain data (avoids SDK dependency on origin recovery).
 */
export interface ExistingKeyEntry {
  logicContract: string;
  keyInitData: string; // ABI-encoded init data (re-encoded from on-chain fields)
  weight: number;
}

/**
 * High-level helpers for txKey list manipulation.
 *
 * txKey updates are full-list replacements — these helpers build the complete
 * encoded txKey for the `updateTxKey(bytes)` smart contract call.
 */
export class TxKeyHelper {
  /**
   * Build encoded txKey that preserves all existing keys + adds a new WebAuthn key.
   *
   * @param existingEntries - On-chain keys to preserve (caller builds from TxKeyInfo)
   * @param newKey - New WebAuthn key to add
   * @param webAuthnImplAddress - Chain's WebAuthn logic contract address
   * @param threshold - Signing threshold (default: 1)
   * @throws If total keys would exceed MAX_TX_KEYS (5)
   */
  static buildAddTxKeyEncoding(
    existingEntries: ExistingKeyEntry[],
    newKey: WebAuthnNewKeyParams,
    webAuthnImplAddress: string,
    threshold: number = 1,
  ): string {
    const totalKeys = existingEntries.length + 1;
    if (totalKeys > MAX_TX_KEYS) {
      throw new AaOperationError({
        code: AaOperationErrorCode.INPUT_OUT_OF_RANGE,
        operation: "build_add_tx_key_encoding",
        message: `Cannot add key: would exceed maximum of ${MAX_TX_KEYS} txKeys (current: ${existingEntries.length})`,
      });
    }
    if (threshold > totalKeys) {
      throw new AaOperationError({
        code: AaOperationErrorCode.SIGNER_THRESHOLD_INVALID,
        operation: "build_add_tx_key_encoding",
        message: `threshold (${threshold}) exceeds total key count (${totalKeys})`,
      });
    }

    const logicList = existingEntries.map((e) => e.logicContract);
    const keyInitDataList = existingEntries.map((e) => e.keyInitData);
    const weightList = existingEntries.map((e) => e.weight);

    // Encode new key via AccountKeyBuilder
    const newKeyInitData = TxKeyHelper._encodeWebAuthnKeyInitData(newKey);
    logicList.push(webAuthnImplAddress);
    keyInitDataList.push(newKeyInitData);
    weightList.push(1);

    return ethers.AbiCoder.defaultAbiCoder().encode(
      ["uint8", "address[]", "bytes[]", "uint8[]"],
      [threshold, logicList, keyInitDataList, weightList],
    );
  }

  /**
   * Build encoded txKey that replaces a key matching the given rpIdHash with a new key.
   * All other keys are preserved.
   *
   * @param existingKeys - TxKeyInfo[] from AccountReader.getTxKeyList()
   * @param rpIdHash - rpIdHash of the key to replace
   * @param newKey - Replacement WebAuthn key
   * @param originResolver - Resolves allowedOriginHash → origin string for existing keys
   * @param webAuthnImplAddress - Chain's WebAuthn logic contract address
   * @param threshold - Signing threshold (default: 1)
   * @throws If no key matches the rpIdHash
   */
  static buildReplaceTxKeyByRpId(
    existingKeys: TxKeyInfo[],
    rpIdHash: string,
    newKey: WebAuthnNewKeyParams,
    originResolver: (hash: string) => string,
    webAuthnImplAddress: string,
    threshold: number = 1,
  ): string {
    const matchIndices = existingKeys
      .map((k, i) =>
        k.keyType === "webauthn" &&
        k.webauthn?.allowedRpIdHash?.toLowerCase() === rpIdHash.toLowerCase()
          ? i
          : -1,
      )
      .filter((i) => i !== -1);

    if (matchIndices.length === 0) {
      throw new AaOperationError({
        code: AaOperationErrorCode.INPUT_INVALID,
        operation: "build_replace_tx_key_by_rp_id",
        message: `No txKey found matching rpIdHash: ${rpIdHash}`,
      });
    }
    if (matchIndices.length > 1) {
      throw new AaOperationError({
        code: AaOperationErrorCode.INPUT_INVALID,
        operation: "build_replace_tx_key_by_rp_id",
        message: `Multiple txKeys (${matchIndices.length}) match rpIdHash: ${rpIdHash}. Use buildRebuildTxKeyEncoding with explicit indices instead.`,
      });
    }

    const matchIndex = matchIndices[0];
    const logicList: string[] = [];
    const keyInitDataList: string[] = [];
    const weightList: number[] = [];

    for (let i = 0; i < existingKeys.length; i++) {
      const key = existingKeys[i];
      if (i === matchIndex) {
        // Replace with new key
        keyInitDataList.push(TxKeyHelper._encodeWebAuthnKeyInitData(newKey));
        logicList.push(webAuthnImplAddress);
        weightList.push(1);
      } else if (key.keyType === "webauthn" && key.webauthn) {
        // Preserve existing WebAuthn key — re-encode from on-chain data
        const origin = originResolver(key.webauthn.allowedOriginHash);
        if (!origin) {
          throw new AaOperationError({
            code: AaOperationErrorCode.INPUT_INVALID,
            operation: "build_replace_tx_key_by_rp_id",
            message: `originResolver returned empty origin for hash: ${key.webauthn.allowedOriginHash}`,
          });
        }
        const reEncodedInitData = TxKeyHelper._reEncodeExistingWebAuthnKey(key, origin);
        logicList.push(key.logicContract);
        keyInitDataList.push(reEncodedInitData);
        weightList.push(1);
      } else {
        throw new AaOperationError({
          code: AaOperationErrorCode.INPUT_UNSUPPORTED,
          operation: "build_replace_tx_key_by_rp_id",
          message: `Non-WebAuthn key at index ${i} (type: ${key.keyType}) cannot be re-encoded. Use buildAddTxKeyEncoding with pre-built ExistingKeyEntry instead.`,
        });
      }
    }

    return ethers.AbiCoder.defaultAbiCoder().encode(
      ["uint8", "address[]", "bytes[]", "uint8[]"],
      [threshold, logicList, keyInitDataList, weightList],
    );
  }

  /**
   * Convert a TxKeyInfo (from AccountReader) to an ExistingKeyEntry for use with buildAddTxKeyEncoding.
   * Requires origin string since on-chain only stores the hash.
   */
  static txKeyInfoToEntry(
    key: TxKeyInfo,
    origin: string,
  ): ExistingKeyEntry {
    if (key.keyType !== "webauthn" || !key.webauthn) {
      throw new AaOperationError({
        code: AaOperationErrorCode.INPUT_UNSUPPORTED,
        operation: "tx_key_info_to_entry",
        message: `Only WebAuthn keys are supported (got: ${key.keyType})`,
      });
    }
    return {
      logicContract: key.logicContract,
      keyInitData: TxKeyHelper._reEncodeExistingWebAuthnKey(key, origin),
      weight: 1,
    };
  }

  /** Encode a new WebAuthn key's initData via AccountKeyBuilder */
  private static _encodeWebAuthnKeyInitData(key: WebAuthnNewKeyParams): string {
    const builder = new AccountKeyBuilder();
    return builder.getEncodedWebAuthnKeyInitData({
      credentialPubkey: key.credentialPubkey,
      credentialId: key.credentialId,
      rpIdHash: key.rpIdHash,
      origin: key.origin,
      requireUV: key.requireUV ?? true,
    } as BuilderWebAuthnKeyData);
  }

  /**
   * Re-encode an existing on-chain WebAuthn key from its individual fields.
   * NOTE: requireUV is always true because on-chain data does not expose this field.
   */
  private static _reEncodeExistingWebAuthnKey(key: TxKeyInfo, origin: string): string {
    const w = key.webauthn!;
    const abiCoder = ethers.AbiCoder.defaultAbiCoder();

    const keyEncoded = abiCoder.encode(
      ["tuple(bytes32 x, bytes32 y, string credentialId)"],
      [{ x: w.x, y: w.y, credentialId: w.credentialId }],
    );

    return abiCoder.encode(
      ["bytes", "bytes32", "bytes", "bool"],
      [keyEncoded, w.allowedRpIdHash, ethers.toUtf8Bytes(origin), true],
    );
  }
}
