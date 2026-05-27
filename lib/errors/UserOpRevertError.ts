import type { AaCode, UserOpRevertPhase } from "./codes";
import { ZkapAaError, type DecodedContractError, type ZkapAaErrorOptions } from "./ZkapAaError";

export interface UserOpRevertErrorOptions extends Omit<ZkapAaErrorOptions, "code"> {
  code: AaCode;
  /** UserOp lifecycle stage (where). Detection context (submit/estimate) is the base `operation`. */
  phase: UserOpRevertPhase;
  /** Original bundler response (pre-stringified). Never dropped — always preserved. */
  rawBundlerError: string;
  /** Decoded inner contract error (best-effort). Undefined when the bundler gives no data. */
  contractError?: DecodedContractError;
  /** Raw revert bytes when available. */
  rawRevertData?: `0x${string}`;
}

/**
 * The chain (EntryPoint) rejected/reverted the UserOp. Both validation rejection
 * (submit) and predicted execution revert (estimate) use this class — the two are
 * distinguished by the base `operation` (submit_user_op vs estimate_user_op_gas).
 * An actual post-mine execution revert is surfaced not as a throw but via
 * `UserOpReceipt` (success:false + revert fields).
 */
export class UserOpRevertError extends ZkapAaError {
  declare readonly code: AaCode;
  readonly phase: UserOpRevertPhase;
  readonly contractError?: DecodedContractError;
  readonly rawRevertData?: `0x${string}`;
  readonly rawBundlerError: string;

  constructor(opts: UserOpRevertErrorOptions) {
    super(opts);
    this.phase = opts.phase;
    this.contractError = opts.contractError;
    this.rawRevertData = opts.rawRevertData;
    this.rawBundlerError = opts.rawBundlerError;
  }
}
