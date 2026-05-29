import { AaCode, type UserOpRevertPhase } from "./codes";

/**
 * Pure error-domain mappings derived from the AA code catalog: AA-prefix → `AaCode`
 * and `AaCode` → lifecycle `phase`. No transport or ethers dependency — these belong
 * with the error model, not the bundler client that consumes them.
 */

// ---------------------------------------------------------------------------
// AA prefix → AaCode
// ---------------------------------------------------------------------------
const AA_PREFIX_TO_CODE: Readonly<Record<string, AaCode>> = {
  AA10: AaCode.AA10_SENDER_ALREADY_CONSTRUCTED,
  AA13: AaCode.AA13_INIT_CODE_FAILED,
  AA14: AaCode.AA14_INIT_CODE_MUST_RETURN_SENDER,
  AA15: AaCode.AA15_INIT_CODE_MUST_CREATE_SENDER,
  AA20: AaCode.AA20_NOT_DEPLOYED,
  AA21: AaCode.AA21_INSUFFICIENT_PREFUND,
  AA22: AaCode.AA22_EXPIRED_OR_NOT_DUE,
  AA23: AaCode.AA23_ACCOUNT_REVERTED,
  AA24: AaCode.AA24_SIGNATURE_ERROR,
  AA25: AaCode.AA25_INVALID_NONCE,
  AA31: AaCode.AA31_PAYMASTER_DEPOSIT_TOO_LOW,
  AA32: AaCode.AA32_PAYMASTER_EXPIRED_OR_NOT_DUE,
  AA33: AaCode.AA33_PAYMASTER_REVERTED,
  AA34: AaCode.AA34_PAYMASTER_SIGNATURE_ERROR,
  AA40: AaCode.AA40_OVER_VERIFICATION_GAS_LIMIT,
  AA41: AaCode.AA41_UNDER_VERIFICATION_GAS,
  AA50: AaCode.AA50_POST_OP_REVERTED,
  AA51: AaCode.AA51_PREFUND_BELOW_GAS_COST,
  AA90: AaCode.AA90_INVALID_BENEFICIARY,
  AA91: AaCode.AA91_FAILED_SEND_TO_BENEFICIARY,
  AA92: AaCode.AA92_INTERNAL_CALL_ONLY,
  AA93: AaCode.AA93_INVALID_PAYMASTER_AND_DATA,
  AA94: AaCode.AA94_GAS_VALUES_OVERFLOW,
  AA95: AaCode.AA95_OUT_OF_GAS,
};

/**
 * Extracts an AA prefix (AA##) from bundler text and maps it to an AaCode.
 * Returns undefined when no AA prefix is present (so the caller can treat it as a
 * channel/execution error). An AA prefix not in the catalog maps to AA_UNKNOWN.
 */
export function mapAaPrefix(text: string): AaCode | undefined {
  const match = text.match(/AA\d{2}/i);
  if (!match) return undefined;
  return AA_PREFIX_TO_CODE[match[0].toUpperCase()] ?? AaCode.UNKNOWN;
}

// ---------------------------------------------------------------------------
// AaCode → phase (lifecycle stage)
// ---------------------------------------------------------------------------
const CODE_TO_PHASE: Readonly<Record<AaCode, UserOpRevertPhase>> = {
  [AaCode.AA10_SENDER_ALREADY_CONSTRUCTED]: "factory",
  [AaCode.AA13_INIT_CODE_FAILED]: "factory",
  [AaCode.AA14_INIT_CODE_MUST_RETURN_SENDER]: "factory",
  [AaCode.AA15_INIT_CODE_MUST_CREATE_SENDER]: "factory",
  [AaCode.AA20_NOT_DEPLOYED]: "account_validation",
  [AaCode.AA21_INSUFFICIENT_PREFUND]: "account_validation",
  [AaCode.AA22_EXPIRED_OR_NOT_DUE]: "account_validation",
  [AaCode.AA23_ACCOUNT_REVERTED]: "account_validation",
  [AaCode.AA24_SIGNATURE_ERROR]: "account_validation",
  [AaCode.AA25_INVALID_NONCE]: "account_validation",
  [AaCode.AA40_OVER_VERIFICATION_GAS_LIMIT]: "account_validation",
  [AaCode.AA41_UNDER_VERIFICATION_GAS]: "account_validation",
  [AaCode.AA31_PAYMASTER_DEPOSIT_TOO_LOW]: "paymaster_validation",
  [AaCode.AA32_PAYMASTER_EXPIRED_OR_NOT_DUE]: "paymaster_validation",
  [AaCode.AA33_PAYMASTER_REVERTED]: "paymaster_validation",
  [AaCode.AA34_PAYMASTER_SIGNATURE_ERROR]: "paymaster_validation",
  // AA50/51 are the paymaster postOp callback (per-op, inside innerHandleOp).
  [AaCode.AA50_POST_OP_REVERTED]: "post_op",
  [AaCode.AA51_PREFUND_BELOW_GAS_COST]: "post_op",
  // AA90/91 fire in `_compensate` — the per-batch beneficiary payout after every op
  // (and its postOp) has run. A distinct settlement stage, not the paymaster postOp.
  [AaCode.AA90_INVALID_BENEFICIARY]: "settlement",
  [AaCode.AA91_FAILED_SEND_TO_BENEFICIARY]: "settlement",
  // AA92 is the `innerHandleOp` access guard (execution entry); AA95 is its gas
  // check immediately before the callData `Exec.call`. Both are execution-path.
  [AaCode.AA92_INTERNAL_CALL_ONLY]: "execution",
  // AA93 is the paymasterAndData length check while parsing the paymaster field.
  [AaCode.AA93_INVALID_PAYMASTER_AND_DATA]: "paymaster_validation",
  // AA94 is the gas-field overflow precheck in `_validatePrepayment`, gating
  // account validation.
  [AaCode.AA94_GAS_VALUES_OVERFLOW]: "account_validation",
  [AaCode.AA95_OUT_OF_GAS]: "execution",
  // The code itself is unknown (off-spec AA prefix), so the stage cannot be derived.
  [AaCode.UNKNOWN]: "unknown",
};

export function aaCodeToPhase(code: AaCode): UserOpRevertPhase {
  return CODE_TO_PHASE[code] ?? "unknown";
}
