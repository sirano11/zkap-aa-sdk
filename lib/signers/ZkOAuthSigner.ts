import { ethers } from "ethers";
import { IUserOpSigner } from "../utils/IUserOpSigner";
import { BN254_FR } from "../utils/crypto";
import zkapAccountJson from "../types/abi/ZkapAccount.json";
import AccountKeyZkOAuthRS256VerifierJson from "../types/abi/AccountKeyZkOAuthRS256Verifier.json";
import poseidonMerkleTreeDirectoryJson from "../types/abi/PoseidonMerkleTreeDirectory.json";
import { JwkKey, JwtHeader } from "../types/jwk";
import { PrimitiveAccountKeyTypes } from "../types/AccountKey";
import { AaOperationError, AaOperationErrorCode, AaFetchError, AaFetchErrorCode } from "../errors";

const JWKS_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
// NOTE: Module-level cache shared across ZkPasskeySigner instances. Use clearJwksCache() for testing.
// MAX_JWKS_CACHE_SIZE limits memory usage by evicting the oldest entry when exceeded.
const MAX_JWKS_CACHE_SIZE = 50;
const jwksCache = new Map<string, { n: string; cachedAt: number }>();

/**
 * @internal For testing purposes only. Do not use in production code.
 */
export function clearJwksCache(): void {
  jwksCache.clear();
}

function decodeJwtHeader(token: string): JwtHeader {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new AaOperationError({
      code: AaOperationErrorCode.SIGNER_JWT_INVALID,
      operation: "decode_jwt_header",
      message: `Invalid JWT format: expected 3 parts, got ${parts.length}`,
    });
  }
  const [headerB64] = parts;
  // JWT uses base64url (- instead of +, _ instead of /, no padding)
  const base64 = headerB64.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const headerJson = Buffer.from(padded, "base64").toString("utf8");
  const header = JSON.parse(headerJson) as JwtHeader;
  if (!header.kid) {
    throw new AaOperationError({
      code: AaOperationErrorCode.SIGNER_JWT_INVALID,
      operation: "decode_jwt_header",
      message: "JWT header missing required field: kid",
    });
  }
  if (header.alg !== "RS256") {
    throw new AaOperationError({
      code: AaOperationErrorCode.SIGNER_JWT_INVALID,
      operation: "decode_jwt_header",
      message: `Unsupported JWT algorithm: ${header.alg}. Only RS256 is supported.`,
    });
  }
  return header;
}

async function getOAuthPublicKey(jwksUrl: string, kid: string): Promise<string> {
  const cacheKey = `${jwksUrl}#${kid}#RS256#RSA`;
  const cached = jwksCache.get(cacheKey);
  if (cached && Date.now() - cached.cachedAt < JWKS_CACHE_TTL_MS) {
    return cached.n;
  }
  const response = await fetch(jwksUrl);
  if (!response.ok) {
    throw new AaFetchError({
      code: AaFetchErrorCode.HTTP_STATUS,
      httpStatus: response.status,
      operation: "get_o_auth_public_key",
      service: "jwks",
      url: jwksUrl,
      method: "GET",
      message: `HTTP error! status: ${response.status}`,
    });
  }
  const data = await response.json();
  if (!data || !Array.isArray(data.keys)) {
    throw new AaFetchError({
      code: AaFetchErrorCode.RESPONSE_SHAPE,
      operation: "get_o_auth_public_key",
      service: "jwks",
      url: jwksUrl,
      method: "GET",
      message: "Invalid JWKS response: missing or malformed 'keys' array",
    });
  }
  const keys: JwkKey[] = data.keys;
  const key = keys.find((key) => key.kid === kid && key.kty === "RSA" && key.use === "sig" && key.alg === "RS256");
  if (!key || typeof key.n !== 'string' || key.n.length === 0) {
    throw new AaOperationError({
      code: AaOperationErrorCode.SIGNER_JWKS_INVALID,
      operation: "get_o_auth_public_key",
      message: `No valid JWK found for kid: ${kid}`,
    });
  }
  // Validate minimum RSA modulus length: 2048-bit = 256 bytes ≈ 342 base64url chars
  if (key.n.length < 300) {
    throw new AaOperationError({
      code: AaOperationErrorCode.SIGNER_JWKS_INVALID,
      operation: "get_o_auth_public_key",
      message: `RSA modulus too short for kid: ${kid}. Minimum 2048-bit key required.`,
    });
  }
  if (typeof key.e !== 'string' || key.e.length === 0) {
    throw new AaOperationError({
      code: AaOperationErrorCode.SIGNER_JWKS_INVALID,
      operation: "get_o_auth_public_key",
      message: `Missing public exponent (e) for kid: ${kid}`,
    });
  }
  if (jwksCache.size >= MAX_JWKS_CACHE_SIZE) {
    const oldestKey = jwksCache.keys().next().value;
    /* istanbul ignore next */
    if (oldestKey !== undefined) {
      jwksCache.delete(oldestKey);
    }
  }
  const existing = jwksCache.get(cacheKey);
  if (existing && existing.n !== key.n) {
    // Key has been rotated under the same kid — update immediately to prevent stale key usage

  }
  jwksCache.set(cacheKey, { n: key.n, cachedAt: Date.now() });
  return key.n;
}

async function getGoogleOAuthPublicKey(kid: string): Promise<string> {
  return getOAuthPublicKey("https://www.googleapis.com/oauth2/v3/certs", kid);
}

async function getKakaoOAuthPublicKey(kid: string): Promise<string> {
  return getOAuthPublicKey("https://kauth.kakao.com/.well-known/jwks.json", kid);
}

/**
 * Signs UserOperations using ZK proofs of OAuth RS256 JWT tokens (Google Sign-In, Kakao).
 *
 * **Supported providers:** `"google"` and `"kakao"` only.
 * Apple and other OIDC providers are not yet supported.
 *
 * **Threshold constraint:** `zkapK` must equal 1. Multi-proof (k>1) threshold signing
 * is not yet implemented. Pass `zkapK=1` and `zkapN` equal to the number of OAuth slots.
 *
 * **Usage flow:**
 * 1. Construct with proof server URL, RPC URL, wallet address, and OAuth provider config.
 * 2. Call `prepareIdToken(userOpHash, index)` for each provider slot before signing.
 * 3. Call `signUserOpHash(userOpHash)` to produce the ABI-encoded ZK proof signature.
 * 4. Call `destroy()` after signing to clear sensitive token data from memory.
 */
export class ZkOAuthSigner implements IUserOpSigner {
  public readonly keyTypes: number[] = [PrimitiveAccountKeyTypes.keyZkOAuthRS256];
  private static readonly PROOF_SERVER_TIMEOUT_MS = 30_000;
  private proofServerUrl: string;
  private readonly enUrl: string;
  private zkapAddress: string;
  private provider: ethers.JsonRpcProvider;
  private zkapAccount: ethers.Contract | undefined;
  private zkOAuthRS256Verifier: ethers.Contract | undefined;
  private isInitialized: boolean = false;
  private initPromise: Promise<void> | undefined;
  private anchor: string[] | undefined;
  private masterKeyId: bigint | undefined;
  private poseidonMerkleTreeDirectory: ethers.Contract | undefined;
  private poseidonMerkleTreeDirectoryAddress: string;
  private socialServices: string[];
  private idTokenGenerators: ((msgHash: string) => Promise<string>)[];
  private selector: boolean[] | undefined;
  private idTokens: string[] | undefined;
  private preparedUserOpHash: string | undefined;
  private _prepareInProgress = false;

  constructor(
    proofServerUrl: string,
    enUrl: string,
    zkapAddress: string,
    socialServices: string[],
    idTokenGenerators: ((msgHash: string) => Promise<string>)[],
    poseidonMerkleTreeDirectoryAddress: string,
    zkapK: number,
    zkapN: number
  ) {
    if (socialServices.length !== idTokenGenerators.length) {
      throw new AaOperationError({
        code: AaOperationErrorCode.SIGNER_THRESHOLD_INVALID,
        operation: "init_zk_o_auth_signer",
        message: "socialServices.length !== idTokenGenerators.length",
      });
    }
    if (socialServices.length > 3) {
      throw new AaOperationError({
        code: AaOperationErrorCode.SIGNER_THRESHOLD_INVALID,
        operation: "init_zk_o_auth_signer",
        message: "socialServices.length must be <= 3 (max 3 OAuth providers supported)",
      });
    }
    if (zkapN <= 0 || zkapN > 3) {
      throw new AaOperationError({
        code: AaOperationErrorCode.SIGNER_THRESHOLD_INVALID,
        operation: "init_zk_o_auth_signer",
        message: "zkapN must be between 1 and 3",
      });
    }
    if (zkapK < 1 || zkapK > zkapN) {
      throw new AaOperationError({
        code: AaOperationErrorCode.SIGNER_THRESHOLD_INVALID,
        operation: "init_zk_o_auth_signer",
        message: `zkapK must be between 1 and zkapN (got zkapK=${zkapK}, zkapN=${zkapN})`,
      });
    }
    if (zkapK !== 1) {
      throw new AaOperationError({
        code: AaOperationErrorCode.SIGNER_THRESHOLD_INVALID,
        operation: "init_zk_o_auth_signer",
        message:
          `ZkOAuthSigner currently supports only zkapK=1 (got zkapK=${zkapK}). ` +
          "For k>1 threshold proofs, use a signer path that provides multi-proof payloads.",
      });
    }
    if (socialServices.length !== zkapN) {
      throw new AaOperationError({
        code: AaOperationErrorCode.SIGNER_THRESHOLD_INVALID,
        operation: "init_zk_o_auth_signer",
        message: `socialServices.length (${socialServices.length}) must equal zkapN (${zkapN}). Each OAuth provider corresponds to one selector slot.`,
      });
    }

    // Enforce HTTPS for proof server (except localhost and private network addresses)
    const proofUrl = new URL(proofServerUrl);
    if (proofUrl.protocol !== 'https:' && !ZkOAuthSigner._isLocalOrPrivateHost(proofUrl.hostname)) {
      throw new AaOperationError({
        code: AaOperationErrorCode.INPUT_INVALID_URL,
        operation: "init_zk_o_auth_signer",
        message:
          'proofServerUrl must use HTTPS. HTTP is only allowed for localhost, 127.0.0.1, ' +
          'RFC1918 private addresses (10.x.x.x, 172.16-31.x.x, 192.168.x.x), and .local domains.',
      });
    }

    const validSocialServices = new Set(['google', 'kakao']);
    for (const service of socialServices) {
      if (!validSocialServices.has(service)) {
        throw new AaOperationError({
          code: AaOperationErrorCode.SIGNER_UNSUPPORTED,
          operation: "init_zk_o_auth_signer",
          message: `Unsupported social service: "${service}". Supported: google, kakao`,
        });
      }
    }

    this.socialServices = socialServices;
    this.idTokenGenerators = idTokenGenerators;
    this.proofServerUrl = proofServerUrl;
    this.enUrl = enUrl;
    this.zkapAddress = zkapAddress;
    this.provider = new ethers.JsonRpcProvider(enUrl);
    this.poseidonMerkleTreeDirectoryAddress =
      poseidonMerkleTreeDirectoryAddress;
    // selector length is set to zkapN, matching the number of idTokens.
    // zkapK true slots + (zkapN - zkapK) false slots.
    // When padded to 3 slots in getSignatures(), false slots are filled with dummy JWTs.
    this.selector = [
      ...Array(zkapK).fill(true),
      ...Array(zkapN - zkapK).fill(false),
    ];

    // Initialize idTokens array with socialServices.length entries
    this.idTokens = Array(socialServices.length).fill("");
  }

  async init(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this._doInit().catch((err) => {
        this.initPromise = undefined; // Reset on failure to allow retry
        throw err;
      });
    }
    return this.initPromise;
  }

  private async _doInit(): Promise<void> {
    this.zkapAccount = new ethers.Contract(
      this.zkapAddress,
      zkapAccountJson.abi,
      this.provider
    );
    // masterKeyList(index) returns KeyRef { logic: address, keyId: uint256 }
    const masterKeyRef = await this.zkapAccount.masterKeyList(0);
    const masterKeyAddress: string = masterKeyRef.logic;
    if (!masterKeyAddress || masterKeyAddress === ethers.ZeroAddress) {
      throw new AaFetchError({
        code: AaFetchErrorCode.RESPONSE_SHAPE,
        operation: "do_init",
        service: "rpc",
        url: this.enUrl,
        method: "POST",
        message: "masterKeyList returned invalid logic address (zero address)",
      });
    }
    this.masterKeyId = masterKeyRef.keyId;

    this.zkOAuthRS256Verifier = new ethers.Contract(
      masterKeyAddress,
      AccountKeyZkOAuthRS256VerifierJson.abi,
      this.provider
    );
    // Fetch anchor from smart contract (KeyPurpose.Master = 0)
    {
      const anchor = await this.zkOAuthRS256Verifier.getAnchor(
        0,
        this.zkapAddress,
        this.masterKeyId
      );
      const anchorUint = anchor.map((x: bigint) => x.toString());
      this.anchor = anchorUint;
    }

    this.poseidonMerkleTreeDirectory = new ethers.Contract(
      this.poseidonMerkleTreeDirectoryAddress,
      poseidonMerkleTreeDirectoryJson.abi,
      this.provider
    );

    this.isInitialized = true;
  }

  private async getSignatures(
    idTokens: string[],
    jwtPks: string[],
    leafIndices: number[],
    merklePaths: string[][]
  ): Promise<string[]> {
    if (!this.poseidonMerkleTreeDirectory) {
      throw new AaOperationError({
        code: AaOperationErrorCode.SIGNER_NOT_INITIALIZED,
        operation: "get_signatures",
        message: "poseidonMerkleTreeDirectory is not initialized",
      });
    }

    const rootHex = await this.poseidonMerkleTreeDirectory.getRoot();
    const root = ethers.toBigInt(rootHex).toString();

    let adjustedIdTokens: string[] = [];
    let adjustedPublicKeys: string[] = [];
    let adjustedLeafIndices: number[] = [];
    let adjustedMerklePaths: string[][] = [];
    const signatures: string[] = [];
    let proofAndPublicInput: { proof: string[]; publicInputs: string[] };

    if (idTokens.length === 0 || idTokens.length > 3) {
      throw new AaOperationError({
        code: AaOperationErrorCode.INPUT_OUT_OF_RANGE,
        operation: "get_signatures",
        message: `Invalid idTokens count: ${idTokens.length}. Must be 1, 2, or 3.`,
      });
    }
    // Validate array length consistency
    if (jwtPks.length !== idTokens.length || leafIndices.length !== idTokens.length || merklePaths.length !== idTokens.length) {
      throw new AaOperationError({
        code: AaOperationErrorCode.INPUT_OUT_OF_RANGE,
        operation: "get_signatures",
        message: `Array length mismatch: idTokens(${idTokens.length}), jwtPks(${jwtPks.length}), leafIndices(${leafIndices.length}), merklePaths(${merklePaths.length}) must all match.`,
      });
    }

    // The ZK proof circuit always receives 3 slots.
    // The selector array marks which slots are actually used, so placing a dummy JWT in unused slots
    // is safe — the circuit ignores selector=false slots (cryptographic safety guaranteed).
    // e.g. length=1, selector=[true,false,false] → only slot 0 is verified
    // e.g. length=2, selector=[true,true,false] → only slots 0 and 1 are verified
    // RS256 signature requires 256 bytes = 342 base64url chars (without padding)
    // Use zero-padded valid-length dummy to avoid proof server JWT format errors on selector=false slots
    // Header: {"alg":"RS256","kid":"dummy"} - kid field required by some proof servers
    const DUMMY_JWT = `eyJhbGciOiJSUzI1NiIsImtpZCI6ImR1bW15In0.e30.${"A".repeat(342)}`;
    const dummyPk = jwtPks[0];
    const dummyLeafIndex = leafIndices[0];
    const dummyMerklePath = merklePaths[0];
    // Replace empty/falsy values in selector=false slots with dummies, then pad to 3 slots
    // ZK circuit always receives 3 slots, so 1/2-slot cases are padded with dummies
    adjustedIdTokens = idTokens.map(t => t || DUMMY_JWT);
    adjustedPublicKeys = jwtPks.map(pk => pk || dummyPk);
    adjustedLeafIndices = leafIndices.map(idx => (idx !== undefined && idx !== null) ? idx : dummyLeafIndex);
    adjustedMerklePaths = merklePaths.map(path => (path && path.length > 0) ? path : dummyMerklePath);
    while (adjustedIdTokens.length < 3) {
      adjustedIdTokens.push(DUMMY_JWT);
      adjustedPublicKeys.push(dummyPk);
      adjustedLeafIndices.push(dummyLeafIndex);
      adjustedMerklePaths.push(dummyMerklePath);
    }

    const now = Math.floor(Date.now() / 1000);
    // If before 2024-01-01 00:00:00 UTC, the device clock is likely incorrect
    const MIN_VALID_EPOCH = 1704067200;
    /* istanbul ignore next */
    if (now < MIN_VALID_EPOCH) {
      throw new AaOperationError({
        code: AaOperationErrorCode.INPUT_INVALID,
        operation: "get_signatures",
        message: `System clock appears incorrect: timestamp ${now} is before 2024-01-01. Check device time settings.`,
      });
    }
    // Current time (Unix timestamp) sent to the proof server. Field name 'exp' is kept to match server API spec.
    const exp = now.toString();
    {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), ZkOAuthSigner.PROOF_SERVER_TIMEOUT_MS);
      let fetchResponse: Response;
      try {
        fetchResponse = await fetch(`${this.proofServerUrl}/proof2`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          signal: controller.signal,
          body: JSON.stringify({
            anchor: this.anchor,
            selector: this.selector,
            jwts: adjustedIdTokens,
            root: root,
            leafIndices: adjustedLeafIndices,
            merklePaths: adjustedMerklePaths,
            jwtPks: adjustedPublicKeys,
            exp: exp,
          }),
        });
      } catch (fetchError) {
        if (fetchError instanceof Error && fetchError.name === 'AbortError') {
          throw new AaFetchError({
            code: AaFetchErrorCode.TIMEOUT,
            operation: "get_signatures",
            service: "proof_server",
            url: `${this.proofServerUrl}/proof2`,
            method: "POST",
            message: `Proof server request timed out after ${ZkOAuthSigner.PROOF_SERVER_TIMEOUT_MS}ms`,
          });
        }
        throw fetchError;
      } finally {
        clearTimeout(timeoutId);
      }

      if (!fetchResponse.ok) {
        let errorBody = '';
        try { errorBody = await fetchResponse.text(); } catch { /* ignore */ }
        throw new AaFetchError({
          code: AaFetchErrorCode.HTTP_STATUS,
          httpStatus: fetchResponse.status,
          operation: "get_signatures",
          service: "proof_server",
          url: `${this.proofServerUrl}/proof2`,
          method: "POST",
          message: `Proof server error! status: ${fetchResponse.status}${errorBody ? `: ${errorBody}` : ''}`,
        });
      }
      proofAndPublicInput = await fetchResponse.json();

      // Validate proof server response
      if (!Array.isArray(proofAndPublicInput.proof) || proofAndPublicInput.proof.length !== 8) {
        throw new AaOperationError({
          code: AaOperationErrorCode.SIGNER_PROOF_INVALID,
          operation: "get_signatures",
          message: `Invalid proof server response: proof must be an array of 8 elements, got ${proofAndPublicInput.proof?.length}`,
        });
      }
      if (!Array.isArray(proofAndPublicInput.publicInputs) || proofAndPublicInput.publicInputs.length !== 8) {
        throw new AaOperationError({
          code: AaOperationErrorCode.SIGNER_PROOF_INVALID,
          operation: "get_signatures",
          message: `Invalid proof server response: publicInputs must be an array of 8 elements, got ${proofAndPublicInput.publicInputs?.length}`,
        });
      }
      // Validate BN254 scalar field range (same validation as ZkOidcSigner.setProofData)
      for (let i = 0; i < proofAndPublicInput.proof.length; i++) {
        let val: bigint;
        try { val = BigInt(proofAndPublicInput.proof[i]); } catch {
          throw new AaOperationError({
            code: AaOperationErrorCode.SIGNER_PROOF_INVALID,
            operation: "get_signatures",
            message: `proof[${i}] is not a valid number: ${proofAndPublicInput.proof[i]}`,
          });
        }
        if (val < 0n || val >= BN254_FR) {
          throw new AaOperationError({
            code: AaOperationErrorCode.CRYPTO_FIELD_RANGE,
            operation: "get_signatures",
            message: `proof[${i}] is out of BN254 scalar field range`,
          });
        }
      }
      for (let i = 0; i < proofAndPublicInput.publicInputs.length; i++) {
        let val: bigint;
        try { val = BigInt(proofAndPublicInput.publicInputs[i]); } catch {
          throw new AaOperationError({
            code: AaOperationErrorCode.SIGNER_PROOF_INVALID,
            operation: "get_signatures",
            message: `publicInputs[${i}] is not a valid number: ${proofAndPublicInput.publicInputs[i]}`,
          });
        }
        if (val < 0n || val >= BN254_FR) {
          throw new AaOperationError({
            code: AaOperationErrorCode.CRYPTO_FIELD_RANGE,
            operation: "get_signatures",
            message: `publicInputs[${i}] is out of BN254 scalar field range`,
          });
        }
      }

      // publicInputs[8] layout (matches Groth16 verifyInputs in AccountKeyZkOAuthRS256Verifier):
      // [0]=hanchor, [1]=h_ctx, [2]=root, [3]=h_sign_userop,
      // [4]=jwt_exp, [5]=partial_rhs, [6]=lhs, [7]=h_aud_list
      const sharedInputs = [
        proofAndPublicInput.publicInputs[0], // hanchor
        proofAndPublicInput.publicInputs[1], // h_ctx
        proofAndPublicInput.publicInputs[2], // root
        proofAndPublicInput.publicInputs[3], // h_sign_userop
        proofAndPublicInput.publicInputs[6], // lhs
        proofAndPublicInput.publicInputs[7], // h_aud_list
      ];
      const jwtExpList = [proofAndPublicInput.publicInputs[4]];
      const partialRhsList = [proofAndPublicInput.publicInputs[5]];
      const proofs = [proofAndPublicInput.proof];

      const abiCoder = ethers.AbiCoder.defaultAbiCoder();
      const encoded = abiCoder.encode(
        ["uint256[6]", "uint256[]", "uint256[]", "uint256[8][]"],
        [sharedInputs, jwtExpList, partialRhsList, proofs]
      );
      signatures.push(encoded);
    }
    return signatures;
  }

  /**
   * Prepares an OAuth ID token for the given UserOp hash.
   * @param userOpHash The UserOperation hash to sign
   * @param index OAuth provider index (0-based)
   * @returns Array of idTokens prepared so far (may be partially initialized).
   *          Calling signUserOpHash() before all slots are filled will throw an error.
   *          Call prepareIdToken() for each index before calling signUserOpHash().
   * @note Single-use per UserOp: create a new instance to process a different userOpHash.
   *       An error will be thrown if userOpHash changes.
   */
  async prepareIdToken(userOpHash: string, index: number): Promise<string[]> {
    if (this._prepareInProgress) {
      throw new AaOperationError({
        code: AaOperationErrorCode.SIGNER_STATE_CONFLICT,
        operation: "prepare_id_token",
        message: "prepareIdToken: concurrent calls are not allowed. Await the previous call before calling again.",
      });
    }
    this._prepareInProgress = true;
    try {
      if (!this.idTokens) {
        throw new AaOperationError({
          code: AaOperationErrorCode.SIGNER_NOT_INITIALIZED,
          operation: "prepare_id_token",
          message: "idTokens is not initialized",
        });
      }
      if (!Number.isInteger(index) || index < 0 || index >= this.idTokens.length)
        throw new AaOperationError({
          code: AaOperationErrorCode.INPUT_OUT_OF_RANGE,
          operation: "prepare_id_token",
          message: `index is out of range: must be a non-negative integer less than ${this.idTokens.length}, got ${index}`,
        });
      if (!this.isInitialized) {
        await this.init();
      }
      if (this.preparedUserOpHash !== undefined && this.preparedUserOpHash !== userOpHash) {
        throw new AaOperationError({
          code: AaOperationErrorCode.SIGNER_STATE_CONFLICT,
          operation: "prepare_id_token",
          message: "[zkap-aa-sdk] prepareIdToken: userOpHash changed. Previous idTokens may be stale.",
        });
      }
      this.preparedUserOpHash = userOpHash;
      if (!this.idTokenGenerators[index])
        throw new AaOperationError({
          code: AaOperationErrorCode.SIGNER_NOT_INITIALIZED,
          operation: "prepare_id_token",
          message: "idTokenGenerator undefined",
        });
      const idToken = await this.idTokenGenerators[index](userOpHash);
      if (!idToken) {
        throw new AaOperationError({
          code: AaOperationErrorCode.SIGNER_NOT_INITIALIZED,
          operation: "prepare_id_token",
          message: "idToken is undefined",
        });
      }

      this.idTokens[index] = idToken;
      return this.idTokens;
    } finally {
      this._prepareInProgress = false;
    }
  }

  async signUserOpHash(userOpHash: string): Promise<string[]> {
    if (this.preparedUserOpHash === undefined) {
      throw new AaOperationError({
        code: AaOperationErrorCode.SIGNER_NOT_INITIALIZED,
        operation: "sign_user_op_hash",
        message: "prepareIdToken() must be called before signUserOpHash(). Call prepareIdToken(userOpHash) first.",
      });
    }
    // H-2: Validate userOpHash format (32-byte hex, 66 chars)
    if (!/^0x[0-9a-fA-F]{64}$/.test(userOpHash)) {
      throw new AaOperationError({
        code: AaOperationErrorCode.INPUT_INVALID_FORMAT,
        operation: "sign_user_op_hash",
        message: `signUserOpHash: userOpHash must be a 0x-prefixed 32-byte hex string (66 chars), got: ${userOpHash}`,
      });
    }
    if (!this.isInitialized) {
      await this.init();
    }
    if (userOpHash !== this.preparedUserOpHash) {
      throw new AaOperationError({
        code: AaOperationErrorCode.SIGNER_STATE_CONFLICT,
        operation: "sign_user_op_hash",
        message: `signUserOpHash: userOpHash mismatch. Expected ${this.preparedUserOpHash}, got ${userOpHash}. Call prepareIdToken() with the correct userOpHash first.`,
      });
    }
    // Verify that all this.idTokens entries are initialized
    if (!this.idTokens) {
      throw new AaOperationError({
        code: AaOperationErrorCode.SIGNER_NOT_INITIALIZED,
        operation: "sign_user_op_hash",
        message: "idTokens is undefined",
      });
    }
    if (!this.selector || this.selector.length !== this.idTokens.length) {
      throw new AaOperationError({
        code: AaOperationErrorCode.SIGNER_NOT_INITIALIZED,
        operation: "sign_user_op_hash",
        message: "selector is not properly initialized",
      });
    }
    // Only selector=true slots are actually used, so only those slots' idToken are required
    for (let i = 0; i < this.idTokens.length; i++) {
      if (this.selector && this.selector[i] === true && this.idTokens[i] === "") {
        throw new AaOperationError({
          code: AaOperationErrorCode.SIGNER_NOT_INITIALIZED,
          operation: "sign_user_op_hash",
          message: `idToken[${i}] is not initialized (selector=true slot requires a token)`,
        });
      }
    }

    // Only parse JWT and look up JWKS for selector=true slots
    // selector=false slots are treated as empty strings (ignored by the circuit)
    const kids = this.idTokens.map((idToken, i) => {
      if (this.selector && this.selector[i] === false) return "";
      const header = decodeJwtHeader(idToken);
      return header.kid;
    });

    const jwtPks = await Promise.all(
      this.socialServices.map(async (service, index) => {
        if (this.selector && this.selector[index] === false) return "";
        if (service === "google") {
          return await getGoogleOAuthPublicKey(kids[index]);
        } else if (service === "kakao") {
          return await getKakaoOAuthPublicKey(kids[index]);
        } else {
          throw new AaOperationError({
            code: AaOperationErrorCode.SIGNER_UNSUPPORTED,
            operation: "sign_user_op_hash",
            message: "Invalid service",
          });
        }
      })
    );

    /* istanbul ignore next */
    if (!this.poseidonMerkleTreeDirectory) {
      throw new AaOperationError({
        code: AaOperationErrorCode.SIGNER_NOT_INITIALIZED,
        operation: "sign_user_op_hash",
        message: "poseidonMerkleTreeDirectory is not initialized",
      });
    }
    const merkleTreeDir = this.poseidonMerkleTreeDirectory;
    const results = await Promise.all(
      jwtPks.map(async (jwtPk, index) => {
        // Skip merkle path lookup for selector=false slots and return dummy values (ignored by circuit)
        if (this.selector && this.selector[index] === false) {
          return { leafIndex: 0, pathUint: [] as string[] };
        }
        const jwtHash = ethers.toBeHex(
          ethers.sha256(ethers.toUtf8Bytes(jwtPk)),
          32
        );
        const leafIndex =
          await merkleTreeDir.getLeafIndexByPubkeyHash(
            jwtHash
          );
        const path = await merkleTreeDir.getMerklePath(
          leafIndex
        );

        const pathUint = path.map((x: string) => ethers.toBigInt(x).toString());

        const leafIndexNum = Number(leafIndex);
        /* istanbul ignore next */
        if (!Number.isSafeInteger(leafIndexNum)) {
          throw new AaOperationError({
            code: AaOperationErrorCode.INPUT_OUT_OF_RANGE,
            operation: "sign_user_op_hash",
            message: `leafIndex ${leafIndex} exceeds safe integer range`,
          });
        }
        return { leafIndex: leafIndexNum, pathUint };
      })
    );

    const leafIndices = results.map((r) => r.leafIndex as number);
    const merklePaths = results.map((r) => r.pathUint);

    return this.getSignatures(this.idTokens, jwtPks, leafIndices, merklePaths);
  }

  /**
   * Removes references to sensitive OAuth token and anchor data from memory.
   * @note Call this after use to prevent reuse of sensitive token data.
   */
  destroy(): void {
    this.idTokens = undefined;
    this.anchor = undefined;
    this.preparedUserOpHash = undefined;
    this.idTokenGenerators = [];
    this.isInitialized = false;
    this.initPromise = undefined;
    this.masterKeyId = undefined;
    this.zkapAccount = undefined;
    this.zkOAuthRS256Verifier = undefined;
    this.poseidonMerkleTreeDirectory = undefined;
  }

  private static _isLocalOrPrivateHost(hostname: string): boolean {
    if (hostname === 'localhost' || hostname === '127.0.0.1') return true;
    // IPv6 loopback: ::1 or [::1] (URL-bracketed form used by new URL())
    if (hostname === '::1' || hostname === '[::1]') return true;
    // IPv4-mapped IPv6: [::ffff:x.x.x.x] (dotted) or [::ffff:xxxx:xxxx] (hex, as normalized by new URL())
    const ipv4MappedMatch = hostname.match(/^\[::ffff:(.+)\]$/i);
    if (ipv4MappedMatch) {
      const mapped = ipv4MappedMatch[1];
      // Hex form: xxxx:xxxx → convert to dotted IPv4
      const hexMatch = mapped.match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
      if (hexMatch) {
        const hi = parseInt(hexMatch[1], 16);
        const lo = parseInt(hexMatch[2], 16);
        const ipv4 = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
        return ZkOAuthSigner._isLocalOrPrivateHost(ipv4);
      }
      // Dotted decimal form: x.x.x.x
      return ZkOAuthSigner._isLocalOrPrivateHost(mapped);
    }
    if (hostname.endsWith('.local')) return true;
    // RFC1918 private ranges: 10.x.x.x, 172.16-31.x.x, 192.168.x.x
    const parts = hostname.split('.').map(Number);
    if (parts.length === 4 && parts.every((p) => !isNaN(p) && p >= 0 && p <= 255)) {
      if (parts[0] === 10) return true;
      if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
      if (parts[0] === 192 && parts[1] === 168) return true;
    }
    return false;
  }
}
