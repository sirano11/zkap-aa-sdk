import { ethers } from "ethers";
import { PrimitiveAccountKeyTypes } from "../types/AccountKey";
import { AaFetchError, AaFetchErrorCode } from "../errors";

/**
 * Discriminated string union representing the cryptographic key scheme used
 * by a ZkapAccount transaction or master key slot.
 *
 * - `"webauthn"` — WebAuthn / FIDO2 passkey (secp256r1 via authenticator).
 * - `"zkOAuth"` — ZK-OAuth RS256 key with zero-knowledge proof of JWT possession.
 * - `"address"` — Plain EOA address key.
 * - `"secp256k1"` — Raw secp256k1 key (Ethereum-native curve).
 * - `"secp256r1"` — Raw secp256r1 / P-256 key.
 * - `"oauthRs256"` — Non-ZK OAuth RS256 key.
 * - `"unknown"` — Key type could not be determined from the on-chain contract.
 */
export type KeyType = "webauthn" | "zkOAuth" | "address" | "secp256k1" | "secp256r1" | "oauthRs256" | "unknown";

/**
 * Public key material and binding identifiers for a WebAuthn key slot.
 */
export interface WebAuthnKeyData {
  /** x-coordinate of the P-256 public key (hex, 32 bytes). */
  x: string;
  /** y-coordinate of the P-256 public key (hex, 32 bytes). */
  y: string;
  /** WebAuthn credential ID associated with this key. */
  credentialId: string;
  /** SHA-256 hash of the allowed origin (e.g. `https://example.com`). */
  allowedOriginHash: string;
  /** SHA-256 hash of the allowed Relying Party ID (rpId). */
  allowedRpIdHash: string;
}

/**
 * Metadata for a single transaction key slot in a ZkapAccount.
 */
export interface TxKeyInfo {
  /** Zero-based position of this key in the `txKeyList`. */
  index: number;
  /** Address of the key logic singleton contract. */
  logicContract: string;
  /** On-chain key ID used to look up key-specific data within the logic contract. */
  keyId: number;
  /** Detected cryptographic scheme for this key slot. */
  keyType: KeyType;
  /** Present when `keyType` is `"webauthn"`; contains the raw WebAuthn key data. */
  webauthn?: WebAuthnKeyData;
}

/**
 * Summary of the master key configuration for a ZkapAccount.
 */
export interface MasterKeyInfo {
  /** Number of signatures required to authorize a master-key operation. */
  threshold: number;
  /** Total number of master key shares detected (1 or 3). */
  keyCount: number;
  /** `true` when the account uses a 3-of-3 threshold master key scheme. */
  is3of3: boolean;
  /** ZK circuit anchor values (Poseidon hashes) for each master key share. */
  anchor: string[];
  /** Address of the ZkOAuth verifier contract that holds the master key data. */
  verifierAddress: string;
}

// Minimal ABI fragments for reading ZkapAccount state
const ZKAP_ACCOUNT_ABI = [
  "function txKeyList(uint256 index) view returns (address logic, uint256 keyId)",
  "function txKeyThreshold() view returns (uint8)",
  "function masterKeyThreshold() view returns (uint8)",
  "function txKeyWeightList(uint256 index) view returns (uint8)",
  "function masterKeyList(uint256 index) view returns (address logic, uint256 keyId)",
];

// WebAuthn singleton ABI (AccountKeyWebAuthn)
// KeyPurpose: Master=0, Tx=1
const WEBAUTHN_KEY_ABI = [
  "function getKeyData(uint8 purpose, address account, uint256 keyId) view returns (bytes32 x, bytes32 y, string credentialId, bytes32 allowedOriginHash, bytes32 allowedRpIdHash)",
];

// ZkOAuth verifier ABI
const ZK_OAUTH_VERIFIER_ABI = [
  "function getAnchor(uint256 keyId) view returns (uint256[] anchor)",
  "function getData(uint256 keyId) view returns (uint256 n, uint256 k, uint256 hAudList, uint256[] anchor)",
];

function keyTypeFromPrimitive(keyType: number): KeyType {
  switch (keyType) {
    case PrimitiveAccountKeyTypes.keyAddress: return "address";
    case PrimitiveAccountKeyTypes.keySecp256k1: return "secp256k1";
    case PrimitiveAccountKeyTypes.keySecp256r1: return "secp256r1";
    case PrimitiveAccountKeyTypes.keyWebAuthn: return "webauthn";
    case PrimitiveAccountKeyTypes.keyOAuthRS256: return "oauthRs256";
    case PrimitiveAccountKeyTypes.keyZkOAuthRS256: return "zkOAuth";
    default: return "unknown";
  }
}

// Attempt to detect key type by calling a type() or keyType() function on the logic contract.
// Falls back to "unknown" on error.
const KEY_TYPE_DETECTOR_ABI = [
  "function keyType() view returns (uint8)",
];

/**
 * Read-only utility for inspecting on-chain state of a deployed ZkapAccount.
 *
 * Connects to the chain via an ethers `JsonRpcProvider` and exposes typed
 * accessors for common account properties such as deployment status, balance,
 * and key configurations.
 *
 * @example
 * ```ts
 * const reader = new AccountReader({ rpcUrl: "https://polygon-rpc.com" });
 * const deployed = await reader.isDeployed("0xYourAccount");
 * const keys = await reader.getTxKeyList("0xYourAccount");
 * ```
 */
export class AccountReader {
  private readonly provider: ethers.JsonRpcProvider;
  private readonly rpcUrl: string;

  /**
   * @param config.rpcUrl - JSON-RPC endpoint URL for the target chain.
   */
  constructor(config: { rpcUrl: string; chainId?: number }) {
    this.rpcUrl = config.rpcUrl;
    this.provider = new ethers.JsonRpcProvider(config.rpcUrl, undefined, {
      staticNetwork: config.chainId ? ethers.Network.from(config.chainId) : true,
    });
  }

  /**
   * Check whether a ZkapAccount has been deployed on-chain.
   *
   * @param address - The counterfactual or deployed account address.
   * @returns `true` if the account has deployed bytecode; `false` if it is still counterfactual.
   */
  async isDeployed(address: string): Promise<boolean> {
    const code = await this.provider.getCode(address);
    return code !== "0x";
  }

  /**
   * Return the native token balance of the account.
   *
   * @param address - The account address to query.
   * @returns The balance in wei as a decimal string.
   */
  async getBalance(address: string): Promise<string> {
    const balance = await this.provider.getBalance(address);
    return balance.toString();
  }

  /**
   * Read all transaction key slots from a deployed ZkapAccount.
   *
   * Iterates `txKeyList` up to a maximum of 5 entries, resolves each slot's
   * key type, and fetches WebAuthn public key data when applicable.
   *
   * @param address - Address of the deployed ZkapAccount.
   * @returns An array of {@link TxKeyInfo} objects, one per occupied key slot.
   * @throws If the underlying RPC call fails for a reason other than an out-of-bounds revert.
   */
  async getTxKeyList(address: string): Promise<TxKeyInfo[]> {
    const account = new ethers.Contract(address, ZKAP_ACCOUNT_ABI, this.provider);
    const result: TxKeyInfo[] = [];

    const MAX_TX_KEYS = 5;
    for (let i = 0; i < MAX_TX_KEYS; i++) {
      let logic: string;
      let keyId: bigint;
      try {
        const entry = await account.txKeyList(i);
        logic = entry[0] as string;
        keyId = entry[1] as bigint;
      } catch {
        // No more entries (reverts when out of bounds)
        break;
      }

      if (!logic || logic === ethers.ZeroAddress) {
        break;
      }

      // Detect key type from logic contract
      const keyType = await this._detectKeyType(logic);
      const info: TxKeyInfo = {
        index: i,
        logicContract: logic,
        keyId: Number(keyId),
        keyType,
      };

      if (keyType === "webauthn") {
        try {
          const webauthnContract = new ethers.Contract(logic, WEBAUTHN_KEY_ABI, this.provider);
          // KeyPurpose.Tx = 1; pass account address so the singleton can look up the correct slot
          const kd = await webauthnContract.getKeyData(1, address, keyId);
          info.webauthn = {
            x: kd[0] as string,
            y: kd[1] as string,
            credentialId: kd[2] as string,
            allowedOriginHash: kd[3] as string,
            allowedRpIdHash: kd[4] as string,
          };
        } catch {
          // getKeyData not available or failed — leave webauthn undefined
        }
      }

      result.push(info);
    }

    return result;
  }

  /**
   * Find txKeys matching the given rpIdHash (SHA-256 of rpId).
   * Returns all WebAuthn keys whose allowedRpIdHash matches.
   */
  async findTxKeysByRpId(address: string, rpIdHash: string): Promise<TxKeyInfo[]> {
    const keys = await this.getTxKeyList(address);
    return keys.filter(
      (k) =>
        k.keyType === "webauthn" &&
        k.webauthn?.allowedRpIdHash?.toLowerCase() === rpIdHash.toLowerCase(),
    );
  }

  /**
   * Read the master key configuration from a deployed ZkapAccount.
   *
   * Queries `masterKeyList(0)` to obtain the verifier address and key ID, then
   * attempts to read anchor data via `getData` or `getAnchor` to determine whether
   * the account uses a 3-of-3 threshold scheme.
   *
   * @param address - Address of the deployed ZkapAccount.
   * @returns A {@link MasterKeyInfo} describing the threshold, key count, anchor values,
   *   and verifier contract address.
   * @throws `Error` if `masterKeyList(0)` cannot be read.
   */
  async getMasterKeyInfo(address: string): Promise<MasterKeyInfo> {
    const account = new ethers.Contract(address, ZKAP_ACCOUNT_ABI, this.provider);

    let logic: string;
    let keyId: bigint;
    try {
      const entry = await account.masterKeyList(0);
      logic = entry[0] as string;
      keyId = entry[1] as bigint;
    } catch (err) {
      throw new AaFetchError({
        code: AaFetchErrorCode.TRANSPORT,
        operation: "get_master_key_info",
        service: "rpc",
        url: this.rpcUrl,
        method: "POST",
        cause: err,
        message: `AccountReader: failed to read masterKeyList(0) for ${address}`,
      });
    }

    let threshold = 1;
    try {
      const t = await account.masterKeyThreshold();
      threshold = Number(t);
    } catch {
      // ignore, default 1
    }

    // Count master keys and detect 3-of-3
    let keyCount = 1;
    const anchorList: string[] = [];
    // Attempt to read anchor data from the verifier
    try {
      const verifierContract = new ethers.Contract(logic, ZK_OAUTH_VERIFIER_ABI, this.provider);
      const data = await verifierContract.getData(keyId);
      const anchor: bigint[] = data[3];
      for (const a of anchor) {
        anchorList.push(a.toString());
      }
      // Infer 3-of-3 from anchor count
      if (anchor.length >= 3) {
        keyCount = 3;
      }
    } catch {
      // Verifier doesn't support getData, try getAnchor
      try {
        const verifierContract = new ethers.Contract(logic, ZK_OAUTH_VERIFIER_ABI, this.provider);
        const anchor: bigint[] = await verifierContract.getAnchor(keyId);
        for (const a of anchor) {
          anchorList.push(a.toString());
        }
        if (anchor.length >= 3) {
          keyCount = 3;
        }
      } catch {
        // Not available
      }
    }

    return {
      threshold,
      keyCount,
      is3of3: keyCount >= 3,
      anchor: anchorList,
      verifierAddress: logic,
    };
  }

  private async _detectKeyType(logicAddress: string): Promise<KeyType> {
    try {
      const contract = new ethers.Contract(logicAddress, KEY_TYPE_DETECTOR_ABI, this.provider);
      const kt = await contract.keyType();
      return keyTypeFromPrimitive(Number(kt));
    } catch {
      return "unknown";
    }
  }
}
