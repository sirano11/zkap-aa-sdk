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
 * phase mapping (`aaCodeToPhase`, errorMap.ts):
 *   factory              → AA10/13/14/15
 *   account_validation   → AA20/21/22/23/24/25, AA40/41
 *   paymaster_validation → AA31/32/33/34
 *   post_op              → AA50/51
 *   unknown              → AA90-95 + UNKNOWN
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
// AaOperationErrorCode — for AaOperationError (39)
// ============================================================================
/**
 * Internal SDK failures (Builder/Signer/Config/Crypto). Sub-categorized by 6
 * prefixes: INPUT_ / STATE_ / ENCODE_ / SIGNER_ / CRYPTO_ / CONFIG_
 * (+ PAYMASTER_DATA_INVALID, UNKNOWN).
 *
 * 24 draft codes + 11 new codes found during static analysis, all named within the
 * existing prefixes. (The "36" in appendix B.3's header is a stale label — the
 * explicit listing is 39.)
 */
export const AaOperationErrorCode = {
  // INPUT — caller passed a bad argument
  INPUT_INVALID_ADDRESS:            "ZKAP_AA_OP_INPUT_INVALID_ADDRESS",
  INPUT_INVALID_CHAIN_ID:           "ZKAP_AA_OP_INPUT_INVALID_CHAIN_ID",
  INPUT_INVALID_URL:                "ZKAP_AA_OP_INPUT_INVALID_URL",
  INPUT_OUT_OF_RANGE:               "ZKAP_AA_OP_INPUT_OUT_OF_RANGE",
  INPUT_INVALID:                    "ZKAP_AA_OP_INPUT_INVALID",

  // STATE — Builder/Signer call-order violation
  STATE_CALL_DATA_NOT_SET:          "ZKAP_AA_OP_STATE_CALL_DATA_NOT_SET",
  STATE_SENDER_NOT_SET:             "ZKAP_AA_OP_STATE_SENDER_NOT_SET",
  STATE_GAS_FIELDS_NOT_SET:         "ZKAP_AA_OP_STATE_GAS_FIELDS_NOT_SET",
  STATE_SIGNER_NOT_INITIALIZED:     "ZKAP_AA_OP_STATE_SIGNER_NOT_INITIALIZED",

  // ENCODE — ABI/hex encoding failure
  ENCODE_METHOD_NOT_IN_ABI:         "ZKAP_AA_OP_ENCODE_METHOD_NOT_IN_ABI",
  ENCODE_CALL_DATA_PARSE:           "ZKAP_AA_OP_ENCODE_CALL_DATA_PARSE",
  ENCODE_INVALID_HEX:               "ZKAP_AA_OP_ENCODE_INVALID_HEX",

  // SIGNER — ZK proof
  SIGNER_ZK_PROOF_INVALID:          "ZKAP_AA_OP_SIGNER_ZK_PROOF_INVALID",
  SIGNER_ZK_SELECTOR_MISMATCH:      "ZKAP_AA_OP_SIGNER_ZK_SELECTOR_MISMATCH",
  SIGNER_ZK_PROOF_SERVER_INVALID_RESPONSE:
                                    "ZKAP_AA_OP_SIGNER_ZK_PROOF_SERVER_INVALID_RESPONSE",

  // SIGNER — OIDC / JWKS / WebAuthn / EOA
  SIGNER_JWT_PARSE_FAILED:          "ZKAP_AA_OP_SIGNER_JWT_PARSE_FAILED",
  SIGNER_JWKS_INVALID:              "ZKAP_AA_OP_SIGNER_JWKS_INVALID",
  SIGNER_COSE_UNSUPPORTED_ALGORITHM:"ZKAP_AA_OP_SIGNER_COSE_UNSUPPORTED_ALGORITHM",
  SIGNER_COSE_NOT_EC2:              "ZKAP_AA_OP_SIGNER_COSE_NOT_EC2",
  SIGNER_INVALID_PUBLIC_KEY:        "ZKAP_AA_OP_SIGNER_INVALID_PUBLIC_KEY",
  SIGNER_THRESHOLD_INVALID:         "ZKAP_AA_OP_SIGNER_THRESHOLD_INVALID",    // new
  SIGNER_INVALID_KEY_FORMAT:        "ZKAP_AA_OP_SIGNER_INVALID_KEY_FORMAT",   // new
  SIGNER_WEBAUTHN_CLIENT_DATA:      "ZKAP_AA_OP_SIGNER_WEBAUTHN_CLIENT_DATA", // new
  SIGNER_CLOCK_INVALID:             "ZKAP_AA_OP_SIGNER_CLOCK_INVALID",        // new

  // CRYPTO — low-level cryptographic validation
  CRYPTO_BN254_FIELD_INVALID:       "ZKAP_AA_OP_CRYPTO_BN254_FIELD_INVALID",
  CRYPTO_ECDSA_NORMALIZATION:       "ZKAP_AA_OP_CRYPTO_ECDSA_NORMALIZATION",
  CRYPTO_BYTE_LENGTH_INVALID:       "ZKAP_AA_OP_CRYPTO_BYTE_LENGTH_INVALID",  // new
  CRYPTO_JWT_FORMAT_INVALID:        "ZKAP_AA_OP_CRYPTO_JWT_FORMAT_INVALID",   // new
  CRYPTO_CLAIM_NOT_FOUND:           "ZKAP_AA_OP_CRYPTO_CLAIM_NOT_FOUND",      // new
  CRYPTO_USER_SPECIFIC_VK_LENGTH:   "ZKAP_AA_OP_CRYPTO_USER_SPECIFIC_VK_LENGTH", // new
  CRYPTO_DER_INVALID:               "ZKAP_AA_OP_CRYPTO_DER_INVALID",          // new (signature.ts DER)

  // Paymaster response shape validation
  PAYMASTER_DATA_INVALID:           "ZKAP_AA_OP_PAYMASTER_DATA_INVALID",      // new

  // CONFIG / registry — library configuration errors
  CONFIG_UNSUPPORTED_CHAIN:         "ZKAP_AA_OP_CONFIG_UNSUPPORTED_CHAIN",
  CONFIG_MISSING_REQUIRED:          "ZKAP_AA_OP_CONFIG_MISSING_REQUIRED",
  CONFIG_INVALID_PAYMASTER_MODE:    "ZKAP_AA_OP_CONFIG_INVALID_PAYMASTER_MODE",
  CONFIG_INVALID_AGGREGATOR:        "ZKAP_AA_OP_CONFIG_INVALID_AGGREGATOR",   // new
  CONFIG_INVALID_PRESET:            "ZKAP_AA_OP_CONFIG_INVALID_PRESET",       // new
  CONFIG_UNKNOWN_PROVIDER:          "ZKAP_AA_OP_CONFIG_UNKNOWN_PROVIDER",     // new

  // fallback
  UNKNOWN:                          "ZKAP_AA_OP_UNKNOWN",
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
export type UserOpRevertPhase =
  | "factory"              // initCode/sender creation (AA10/13/14/15)
  | "account_validation"   // account validation (AA20-25, AA40/41)
  | "paymaster_validation" // paymaster validation (AA31-34)
  | "execution"            // actual callData execution
  | "post_op"              // paymaster postOp (AA50/51)
  | "unknown";             // fallback when AA prefix extraction fails

// ============================================================================
// OPERATIONS — throw-site function-name catalog (snake_case)
// ============================================================================
/**
 * Values for the `operation` field. Naming rules (error-modeling.html §7 /
 * error-catalog-mapping.md §4):
 * (a) JS function name → snake_case, private `_` prefix stripped (`_doInit` → `do_init`).
 * (b) constructor → `init`.
 * (c) Both public methods and internal helpers are included (the throwing function
 *     is the attribution basis).
 *
 * Extended as throw sites are migrated in PR2/PR3; register here when adding a new
 * throw site. Org-aligned with bank/cex: a closed catalog (consistent telemetry schema).
 */
export const OPERATIONS = [
  "auto_fill_paymaster_data",
  "auto_fill_user_op",
  "build_add_tx_key_encoding",
  "build_replace_tx_key_by_rp_id",
  "check_allowance",
  "check_threshold",
  "compute_h_aud_list",
  "decode",
  "decode_jwt_header",
  "derive_address",
  "do_init",
  "encode",
  "encode_user_op_for_paymaster",
  "estimate_call_gas",
  "estimate_call_gas_limit",
  "estimate_paymaster_post_op_gas_limit",
  "estimate_paymaster_verification_gas_limit",
  "estimate_user_op_gas",          // Erc4337BundlerProvider.estimateUserOpGas (predicted revert)
  "estimate_user_op_gas_cost",
  "estimate_verification_gas",
  "formatting_modulor_n",
  "from_hex",
  "from_preset",
  "get_approval_tx_data",
  "get_chain_config",
  "get_client_id",
  "get_encoded_ec_key",
  "get_encoded_web_authn_key",
  "get_encoded_zk_o_auth_rs256_key",
  "get_encoded_zk_o_auth_rs256_key_init_data",
  "get_master_key_info",
  "get_o_auth_public_key",
  "get_out_of_circuit_hash_segment",
  "get_paymaster_data",
  "get_paymaster_data_erc20",
  "get_provider_entry",
  "get_required_prefund",
  "get_signatures",
  "get_status",
  "get_supported_chains",
  "get_swap_tx_data",
  "get_user_op",
  "get_value_offset_from_key",
  "init",                          // constructor normalized
  "parse_chain_config",
  "prepare_id_token",
  "request_paymaster_data",
  "rpc_call",
  "send_transaction",
  "set_call_data",
  "set_encoded_key_data",
  "set_init_code",
  "set_paymaster",
  "set_proof_data",
  "set_sender",
  "set_signer_key_types",
  "set_update_keys_call_data",
  "set_update_master_key_call_data",
  "set_update_tx_key_call_data",
  "sha256_block_compress",
  "sha256_block_compress_with_state",
  "sign_user_op_hash",
  "str_to_fields_b_n254",
  "submit_user_op",
  "to_pimlico_format",
  "tx_key_info_to_entry",
  "unwrap_signature",
  "update_user_op_call_data_for_paymaster_erc20",
  "user_specific_vk_parser",
  "user_specific_vk_to_string_array",
  "validate_b_n254_field",
  "wait_for_receipt",
] as const;
export type OperationType = (typeof OPERATIONS)[number];
