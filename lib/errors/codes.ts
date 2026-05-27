/**
 * 에러 코드 카탈로그 + operation 카탈로그.
 *
 * Source: `error-modeling.html` 부록 B (코드 카탈로그), `error-catalog-mapping.md`
 * (198 throw 사이트 전수 매핑). 구조는 `zkap-bank/src/errors/codes.ts` org 컨벤션에 정렬.
 *
 * 패턴:
 * - 카탈로그 객체는 `as const`로 export(IDE 자동완성 + rename refactor 안전).
 * - 타입은 객체에서 derive(union). `Object.values()` 배열 view도 export(런타임 iteration/테스트).
 * - 객체명은 `Zkap` 접두 없이(`AaCode`/`AaFetchErrorCode`/`AaOperationErrorCode`),
 *   타입은 bank 패턴대로 `ZkapAa*ErrorCode`(객체≠타입).
 *
 * facts-only: `retryable`/`hint`/`retryAfterMs` 없음(사실/정책 분리). raw 보존은
 * 클래스 필드(`rawBundlerError`/`rawResponse`)로, 정책은 consumer가.
 */

// ============================================================================
// AaCode — UserOpRevertError 용 (ERC-4337 AA prefix 24개 + UNKNOWN = 25개)
// ============================================================================
/**
 * 체인(EntryPoint)이 UserOp을 거부할 때의 AA-prefix 식별자. prefix(AA10-AA95) +
 * 의미를 합친 self-documenting 문자열. prefix는 보존(bundler 로그와 cross-reference).
 *
 * phase 매핑(`aaCodeToPhase`, errorMap.ts):
 *   factory             → AA10/13/14/15
 *   account_validation  → AA20/21/22/23/24/25, AA40/41
 *   paymaster_validation→ AA31/32/33/34
 *   post_op             → AA50/51
 *   unknown             → AA90-95 + UNKNOWN
 */
export const AaCode = {
  // factory — initCode / sender 생성
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

  // bundler internal (드뭄 — bundler 자체 정책 거부)
  AA90_INVALID_BENEFICIARY:          "AA90_INVALID_BENEFICIARY",
  AA91_FAILED_SEND_TO_BENEFICIARY:   "AA91_FAILED_SEND_TO_BENEFICIARY",
  AA92_INTERNAL_CALL_ONLY:           "AA92_INTERNAL_CALL_ONLY",
  AA93_INVALID_PAYMASTER_AND_DATA:   "AA93_INVALID_PAYMASTER_AND_DATA",
  AA94_GAS_VALUES_OVERFLOW:          "AA94_GAS_VALUES_OVERFLOW",
  AA95_OUT_OF_GAS:                   "AA95_OUT_OF_GAS",

  // fallback — AA prefix 추출 실패 / spec외 응답
  UNKNOWN:                           "AA_UNKNOWN",
} as const;
export type AaCode = (typeof AaCode)[keyof typeof AaCode];
export const AA_CODES = Object.values(AaCode) as readonly AaCode[];

// ============================================================================
// AaFetchErrorCode — AaFetchError 용 (4 모드 + UNKNOWN = 5개)
// ============================================================================
/**
 * 외부 HTTP/RPC 호출 실패. 더 잘게 나누는 안(DNS/TLS/연결거부)도 고려했으나
 * consumer 처리가 모두 "재시도 가능"으로 동일해 합침. 상세 사유는 `cause`로.
 */
export const AaFetchErrorCode = {
  TRANSPORT:      "ZKAP_AA_FETCH_TRANSPORT",      // fetch() 자체 throw (DNS/TCP/TLS/끊김)
  TIMEOUT:        "ZKAP_AA_FETCH_TIMEOUT",        // AbortController 타임아웃
  HTTP_STATUS:    "ZKAP_AA_FETCH_HTTP_STATUS",    // 2xx 아님 (httpStatus 필드 보존)
  RESPONSE_SHAPE: "ZKAP_AA_FETCH_RESPONSE_SHAPE", // 2xx인데 parse/검증 실패
  UNKNOWN:        "ZKAP_AA_FETCH_UNKNOWN",
} as const;
export type ZkapAaFetchErrorCode = (typeof AaFetchErrorCode)[keyof typeof AaFetchErrorCode];
export const ZKAP_AA_FETCH_CODES = Object.values(AaFetchErrorCode) as readonly ZkapAaFetchErrorCode[];

// ============================================================================
// AaOperationErrorCode — AaOperationError 용 (39개)
// ============================================================================
/**
 * SDK 내부 실패(Builder/Signer/Config/Crypto). 6개 prefix로 세분:
 * INPUT_ / STATE_ / ENCODE_ / SIGNER_ / CRYPTO_ / CONFIG_ (+ PAYMASTER_DATA_INVALID, UNKNOWN).
 *
 * 초안 24개 + 정적 분석 중 발견된 신규 11개. 모두 기존 prefix 안에서 명명.
 * (부록 B.3 헤더의 "36"은 라벨 오기 — 실제 명시 코드는 39개.)
 */
export const AaOperationErrorCode = {
  // INPUT — 호출자가 잘못된 인자
  INPUT_INVALID_ADDRESS:            "ZKAP_AA_OP_INPUT_INVALID_ADDRESS",
  INPUT_INVALID_CHAIN_ID:           "ZKAP_AA_OP_INPUT_INVALID_CHAIN_ID",
  INPUT_INVALID_URL:                "ZKAP_AA_OP_INPUT_INVALID_URL",
  INPUT_OUT_OF_RANGE:               "ZKAP_AA_OP_INPUT_OUT_OF_RANGE",
  INPUT_INVALID:                    "ZKAP_AA_OP_INPUT_INVALID",

  // STATE — Builder/Signer 호출 순서 위반
  STATE_CALL_DATA_NOT_SET:          "ZKAP_AA_OP_STATE_CALL_DATA_NOT_SET",
  STATE_SENDER_NOT_SET:             "ZKAP_AA_OP_STATE_SENDER_NOT_SET",
  STATE_GAS_FIELDS_NOT_SET:         "ZKAP_AA_OP_STATE_GAS_FIELDS_NOT_SET",
  STATE_SIGNER_NOT_INITIALIZED:     "ZKAP_AA_OP_STATE_SIGNER_NOT_INITIALIZED",

  // ENCODE — ABI/hex 인코딩 실패
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
  SIGNER_THRESHOLD_INVALID:         "ZKAP_AA_OP_SIGNER_THRESHOLD_INVALID",    // 신규
  SIGNER_INVALID_KEY_FORMAT:        "ZKAP_AA_OP_SIGNER_INVALID_KEY_FORMAT",   // 신규
  SIGNER_WEBAUTHN_CLIENT_DATA:      "ZKAP_AA_OP_SIGNER_WEBAUTHN_CLIENT_DATA", // 신규
  SIGNER_CLOCK_INVALID:             "ZKAP_AA_OP_SIGNER_CLOCK_INVALID",        // 신규

  // CRYPTO — 저수준 암호학 검증
  CRYPTO_BN254_FIELD_INVALID:       "ZKAP_AA_OP_CRYPTO_BN254_FIELD_INVALID",
  CRYPTO_ECDSA_NORMALIZATION:       "ZKAP_AA_OP_CRYPTO_ECDSA_NORMALIZATION",
  CRYPTO_BYTE_LENGTH_INVALID:       "ZKAP_AA_OP_CRYPTO_BYTE_LENGTH_INVALID",  // 신규
  CRYPTO_JWT_FORMAT_INVALID:        "ZKAP_AA_OP_CRYPTO_JWT_FORMAT_INVALID",   // 신규
  CRYPTO_CLAIM_NOT_FOUND:           "ZKAP_AA_OP_CRYPTO_CLAIM_NOT_FOUND",      // 신규
  CRYPTO_USER_SPECIFIC_VK_LENGTH:   "ZKAP_AA_OP_CRYPTO_USER_SPECIFIC_VK_LENGTH", // 신규
  CRYPTO_DER_INVALID:               "ZKAP_AA_OP_CRYPTO_DER_INVALID",          // 신규 (signature.ts DER)

  // Paymaster 응답 형식 검증
  PAYMASTER_DATA_INVALID:           "ZKAP_AA_OP_PAYMASTER_DATA_INVALID",      // 신규

  // CONFIG / registry — 라이브러리 설정 오류
  CONFIG_UNSUPPORTED_CHAIN:         "ZKAP_AA_OP_CONFIG_UNSUPPORTED_CHAIN",
  CONFIG_MISSING_REQUIRED:          "ZKAP_AA_OP_CONFIG_MISSING_REQUIRED",
  CONFIG_INVALID_PAYMASTER_MODE:    "ZKAP_AA_OP_CONFIG_INVALID_PAYMASTER_MODE",
  CONFIG_INVALID_AGGREGATOR:        "ZKAP_AA_OP_CONFIG_INVALID_AGGREGATOR",   // 신규
  CONFIG_INVALID_PRESET:            "ZKAP_AA_OP_CONFIG_INVALID_PRESET",       // 신규
  CONFIG_UNKNOWN_PROVIDER:          "ZKAP_AA_OP_CONFIG_UNKNOWN_PROVIDER",     // 신규

  // fallback
  UNKNOWN:                          "ZKAP_AA_OP_UNKNOWN",
} as const;
export type ZkapAaOperationErrorCode = (typeof AaOperationErrorCode)[keyof typeof AaOperationErrorCode];
export const ZKAP_AA_OP_CODES = Object.values(AaOperationErrorCode) as readonly ZkapAaOperationErrorCode[];

// ============================================================================
// 공통 union — base ZkapAaError.code 타입
// ============================================================================
export type ZkapAaCode = AaCode | ZkapAaFetchErrorCode | ZkapAaOperationErrorCode;

// ============================================================================
// UserOpRevertPhase — UserOp 라이프사이클 단계 (탐지맥락 아님)
// ============================================================================
export type UserOpRevertPhase =
  | "factory"              // initCode/sender 생성 (AA10/13/14/15)
  | "account_validation"   // 어카운트 검증 (AA20-25, AA40/41)
  | "paymaster_validation" // paymaster 검증 (AA31-34)
  | "execution"            // callData 실제 실행 단계
  | "post_op"              // paymaster postOp (AA50/51)
  | "unknown";             // AA prefix 추출 실패 fallback

// ============================================================================
// OPERATIONS — throw 사이트 함수명 카탈로그 (snake_case)
// ============================================================================
/**
 * `operation` 필드 값. 명명 규칙(error-modeling.html §7 / error-catalog-mapping.md §4):
 * (a) JS 함수명 → snake_case, private `_` prefix 제거(`_doInit` → `do_init`).
 * (b) constructor → `init`로 통일.
 * (c) public 메서드 + internal helper 모두 포함(throw 발생 함수가 attribution 기준).
 *
 * PR2/PR3에서 throw 사이트 전환하며 누락분 추가. 신규 throw 추가 시 여기 등록.
 * org 정렬: bank/cex와 동일하게 닫힌 카탈로그(telemetry 스키마 일관).
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
  "estimate_user_op_gas",          // Erc4337BundlerProvider.estimateUserOpGas (예측 revert)
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
  "init",                          // constructor 통일
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
