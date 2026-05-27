import type { AaCode, UserOpRevertPhase } from "./codes";
import { ZkapAaError, type DecodedContractError, type ZkapAaErrorOptions } from "./ZkapAaError";

export interface UserOpRevertErrorOptions extends Omit<ZkapAaErrorOptions, "code"> {
  code: AaCode;
  /** UserOp 라이프사이클 단계(어디서). 탐지맥락(submit/estimate)은 base `operation`으로 구분. */
  phase: UserOpRevertPhase;
  /** bundler 응답 원본(사전 stringify). 손실 금지 — 항상 보존. */
  rawBundlerError: string;
  /** inner 커스텀 에러 디코드 결과(best-effort). bundler가 data 안 주면 undefined. */
  contractError?: DecodedContractError;
  /** 원본 revert bytes(있을 때만). */
  rawRevertData?: `0x${string}`;
}

/**
 * 체인(EntryPoint)이 UserOp을 거부/revert. validation 거부(제출)와 execution revert
 * 예측(estimate) 모두 이 클래스 — 둘 구분은 base `operation`(submit_user_op vs
 * estimate_user_op_gas)으로. 채굴 후 실제 execution revert는 throw가 아니라
 * `UserOpReceipt`(success:false + revert 필드)로 surface.
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
