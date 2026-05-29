/**
 * Error code catalogs + operation catalog.
 *
 * Source: `error-modeling.html` appendix B (code catalogs) and
 * `error-catalog-mapping.md` (full mapping of 198 throw sites). Structure aligned
 * with the `zkap-bank/src/errors/codes.ts` org convention.
 *
 * Pattern:
 * - Catalog objects are exported `as const` (IDE autocomplete + safe rename refactor).
 * - Types are derived from the objects (unions). `Object.values()` array views are
 *   also exported (runtime iteration / tests).
 * - Object names drop the `Zkap` prefix (`AaCode` / `AaFetchErrorCode` /
 *   `AaOperationErrorCode`); types follow the bank pattern `ZkapAa*ErrorCode`
 *   (object != type).
 *
 * Facts-only: no `retryable` / `hint` / `retryAfterMs` (facts-vs-policy separation).
 * Raw preservation lives in class fields (`rawBundlerError` / `rawResponse`); policy
 * stays with the consumer.
 */

// ============================================================================
// AaCode — for UserOpRevertError (24 ERC-4337 AA prefixes + UNKNOWN = 25)
// ============================================================================
/**
 * AA-prefix identifier for when the chain (EntryPoint) rejects a UserOp. Combines
 * the prefix (AA10-AA95) with a self-documenting meaning. The prefix is preserved
 * so it cross-references with bundler logs.
 *
 * phase mapping (`aaCodeToPhase`, phase.ts):
 *   factory              → AA10/13/14/15
 *   account_validation   → AA20/21/22/23/24/25, AA40/41, AA94
 *   paymaster_validation → AA31/32/33/34, AA93
 *   execution            → AA92, AA95
 *   post_op              → AA50/51
 *   settlement           → AA90/91
 *   unknown              → UNKNOWN (off-spec / unrecognized AA prefix)
 */
export const AaCode = {
  // factory — initCode / sender creation
  AA10_SENDER_ALREADY_CONSTRUCTED:   "AA10_SENDER_ALREADY_CONSTRUCTED",
  AA13_INIT_CODE_FAILED:             "AA13_INIT_CODE_FAILED",
  AA14_INIT_CODE_MUST_RETURN_SENDER: "AA14_INIT_CODE_MUST_RETURN_SENDER",
  AA15_INIT_CODE_MUST_CREATE_SENDER: "AA15_INIT_CODE_MUST_CREATE_SENDER",

  // account_validation — validateUserOp
  AA20_NOT_DEPLOYED:                 "AA20_NOT_DEPLOYED",
  AA21_INSUFFICIENT_PREFUND:         "AA21_INSUFFICIENT_PREFUND",
  AA22_EXPIRED_OR_NOT_DUE:           "AA22_EXPIRED_OR_NOT_DUE",
  AA23_ACCOUNT_REVERTED:             "AA23_ACCOUNT_REVERTED",
  AA24_SIGNATURE_ERROR:              "AA24_SIGNATURE_ERROR",
  AA25_INVALID_NONCE:                "AA25_INVALID_NONCE",
  AA40_OVER_VERIFICATION_GAS_LIMIT:  "AA40_OVER_VERIFICATION_GAS_LIMIT",
  AA41_UNDER_VERIFICATION_GAS:       "AA41_UNDER_VERIFICATION_GAS",

  // paymaster_validation
  AA31_PAYMASTER_DEPOSIT_TOO_LOW:    "AA31_PAYMASTER_DEPOSIT_TOO_LOW",
  AA32_PAYMASTER_EXPIRED_OR_NOT_DUE: "AA32_PAYMASTER_EXPIRED_OR_NOT_DUE",
  AA33_PAYMASTER_REVERTED:           "AA33_PAYMASTER_REVERTED",
  AA34_PAYMASTER_SIGNATURE_ERROR:    "AA34_PAYMASTER_SIGNATURE_ERROR",

  // post_op
  AA50_POST_OP_REVERTED:             "AA50_POST_OP_REVERTED",
  AA51_PREFUND_BELOW_GAS_COST:       "AA51_PREFUND_BELOW_GAS_COST",

  // bundler internal (rare — bundler's own policy rejection)
  AA90_INVALID_BENEFICIARY:          "AA90_INVALID_BENEFICIARY",
  AA91_FAILED_SEND_TO_BENEFICIARY:   "AA91_FAILED_SEND_TO_BENEFICIARY",
  AA92_INTERNAL_CALL_ONLY:           "AA92_INTERNAL_CALL_ONLY",
  AA93_INVALID_PAYMASTER_AND_DATA:   "AA93_INVALID_PAYMASTER_AND_DATA",
  AA94_GAS_VALUES_OVERFLOW:          "AA94_GAS_VALUES_OVERFLOW",
  AA95_OUT_OF_GAS:                   "AA95_OUT_OF_GAS",

  // fallback — AA prefix extraction failed / off-spec response
  UNKNOWN:                           "AA_UNKNOWN",
} as const;
export type AaCode = (typeof AaCode)[keyof typeof AaCode];
export const AA_CODES = Object.values(AaCode) as readonly AaCode[];

// ============================================================================
// AaFetchErrorCode — for AaFetchError (4 modes + UNKNOWN = 5)
// ============================================================================
/**
 * External HTTP/RPC call failures. Finer splits (DNS / TLS / connection refused)
 * were considered but collapsed since the consumer handling is uniformly
 * "retryable". Detailed reason is available via `cause`.
 */
export const AaFetchErrorCode = {
  TRANSPORT:      "ZKAP_AA_FETCH_TRANSPORT",      // fetch() itself threw (DNS/TCP/TLS/dropped)
  TIMEOUT:        "ZKAP_AA_FETCH_TIMEOUT",        // AbortController timeout
  HTTP_STATUS:    "ZKAP_AA_FETCH_HTTP_STATUS",    // non-2xx (httpStatus field preserved)
  RESPONSE_SHAPE: "ZKAP_AA_FETCH_RESPONSE_SHAPE", // 2xx but parse/validation failed
  UNKNOWN:        "ZKAP_AA_FETCH_UNKNOWN",
} as const;
export type ZkapAaFetchErrorCode = (typeof AaFetchErrorCode)[keyof typeof AaFetchErrorCode];
export const ZKAP_AA_FETCH_CODES = Object.values(AaFetchErrorCode) as readonly ZkapAaFetchErrorCode[];

// ============================================================================
// AaOperationErrorCode — for AaOperationError (23 + UNKNOWN)
// ============================================================================
/**
 * Internal SDK failures, grouped into 6 domains: INPUT / CONFIG / STATE / ENCODE /
 * CRYPTO / SIGNER (+ UNKNOWN). Each code is a coarse, message-spanning bucket — the
 * specific detail lives in the error `message`, so the code never has to be force-fit
 * and the same kind of failure always maps to the same code (23 codes + UNKNOWN).
 */
export const AaOperationErrorCode = {
  // INPUT — caller-supplied value is invalid
  INPUT_INVALID_ADDRESS:         "ZKAP_AA_OP_INPUT_INVALID_ADDRESS",   // bad/zero Ethereum address
  INPUT_INVALID_URL:             "ZKAP_AA_OP_INPUT_INVALID_URL",       // bad/insecure URL
  INPUT_INVALID_FORMAT:          "ZKAP_AA_OP_INPUT_INVALID_FORMAT",    // wrong byte/string shape (hex, userOpHash, packed field, DER)
  INPUT_OUT_OF_RANGE:            "ZKAP_AA_OP_INPUT_OUT_OF_RANGE",      // numeric/count/size bounds (incl. non-empty, length mismatch)
  INPUT_UNSUPPORTED:             "ZKAP_AA_OP_INPUT_UNSUPPORTED",       // unsupported option (keyType, aggregator, paymaster mode)
  INPUT_INVALID:                 "ZKAP_AA_OP_INPUT_INVALID",           // invalid argument not covered by the specific INPUT_* kinds

  // CONFIG — library/provider configuration
  CONFIG_REQUIRED_FIELD_MISSING: "ZKAP_AA_OP_CONFIG_REQUIRED_FIELD_MISSING", // required config absent
  CONFIG_UNSUPPORTED:            "ZKAP_AA_OP_CONFIG_UNSUPPORTED",            // unknown preset/provider

  // STATE — builder used before its prerequisites
  STATE_MISSING_DEPENDENCY:      "ZKAP_AA_OP_STATE_MISSING_DEPENDENCY", // injected dep absent (provider, paymaster service)
  STATE_FIELD_NOT_SET:           "ZKAP_AA_OP_STATE_FIELD_NOT_SET",      // builder field not set (sender, callData, gas, signerKeyTypes, initCode)

  // ENCODE — ABI encode/decode
  ENCODE_METHOD_NOT_IN_ABI:      "ZKAP_AA_OP_ENCODE_METHOD_NOT_IN_ABI",
  ENCODE_PARSE_FAILED:           "ZKAP_AA_OP_ENCODE_PARSE_FAILED",      // callData parse / unsupported function

  // CRYPTO — low-level cryptographic validation
  CRYPTO_FIELD_RANGE:            "ZKAP_AA_OP_CRYPTO_FIELD_RANGE",       // BN254 scalar field range
  CRYPTO_INVALID_LENGTH:         "ZKAP_AA_OP_CRYPTO_INVALID_LENGTH",    // byte-length multiple, vk length
  CRYPTO_CLAIM_NOT_FOUND:        "ZKAP_AA_OP_CRYPTO_CLAIM_NOT_FOUND",   // JWT payload claim/offset not found

  // SIGNER — authentication / proof / key material
  SIGNER_JWT_INVALID:            "ZKAP_AA_OP_SIGNER_JWT_INVALID",       // JWT format/kid/algorithm
  SIGNER_JWKS_INVALID:           "ZKAP_AA_OP_SIGNER_JWKS_INVALID",      // JWKS keys/modulus/exponent
  SIGNER_PROOF_INVALID:          "ZKAP_AA_OP_SIGNER_PROOF_INVALID",     // proof data / proof-server response shape
  SIGNER_KEY_INVALID:            "ZKAP_AA_OP_SIGNER_KEY_INVALID",       // COSE key, private key, WebAuthn clientDataJSON
  SIGNER_THRESHOLD_INVALID:      "ZKAP_AA_OP_SIGNER_THRESHOLD_INVALID", // threshold / zkapN,K / social count
  SIGNER_NOT_INITIALIZED:        "ZKAP_AA_OP_SIGNER_NOT_INITIALIZED",   // prepareIdToken first / idTokens|selector not initialized
  SIGNER_STATE_CONFLICT:         "ZKAP_AA_OP_SIGNER_STATE_CONFLICT",    // concurrent call / stale (userOpHash changed/mismatch)
  SIGNER_UNSUPPORTED:            "ZKAP_AA_OP_SIGNER_UNSUPPORTED",       // unsupported social service

  // fallback
  UNKNOWN:                       "ZKAP_AA_OP_UNKNOWN",
} as const;
export type ZkapAaOperationErrorCode = (typeof AaOperationErrorCode)[keyof typeof AaOperationErrorCode];
export const ZKAP_AA_OP_CODES = Object.values(AaOperationErrorCode) as readonly ZkapAaOperationErrorCode[];

// ============================================================================
// Shared union — type of base ZkapAaError.code
// ============================================================================
export type ZkapAaCode = AaCode | ZkapAaFetchErrorCode | ZkapAaOperationErrorCode;

// ============================================================================
// UserOpRevertPhase — UserOp lifecycle stage (not detection context)
// ============================================================================
/**
 * UserOp lifecycle stage at which the EntryPoint rejected/reverted the op, following
 * the ERC-4337 `handleOps` flow (validation → execution → post-op/settlement). This is
 * the *stage*, not the detection context — submit vs estimate is carried by `operation`.
 *
 * `phase` is a coarse bucket; the precise signal is always in `code`.
 */
export type UserOpRevertPhase =
  // initCode ran to deploy the sender account.
  // AA10 (already constructed), AA13/14/15 (initCode failed / bad return).
  | "factory"
  // account's validateUserOp, plus the pre-validation gas/prefund checks that gate it.
  // AA20-25 (deploy / prefund / expiry / revert / sig / nonce), AA40/41 (verification
  // gas), AA94 (gas-field overflow precheck in _validatePrepayment).
  | "account_validation"
  // paymaster's validatePaymasterUserOp, plus parsing of the paymasterAndData field.
  // AA31-34 (deposit / expiry / revert / sig), AA93 (paymasterAndData too short).
  | "paymaster_validation"
  // EntryPoint executed the op's callData (innerHandleOp).
  // AA92 (internal-call guard on innerHandleOp), AA95 (out of gas before the callData call).
  | "execution"
  // paymaster postOp callback, run per-op right after the callData executes.
  // AA50 (postOp reverted), AA51 (prefund below actual gas cost).
  | "post_op"
  // per-batch settlement in `_compensate`: EntryPoint pays the collected fees to the
  // bundler's beneficiary, once after every op (and its postOp) has run.
  // AA90 (invalid beneficiary), AA91 (failed send to beneficiary).
  | "settlement"
  // not attributable to a stage: the AA prefix was off-spec / unrecognized
  // (AaCode.UNKNOWN), so the code itself is unknown and no stage can be derived.
  | "unknown";

