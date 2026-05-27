import type { ZkapAaOperationErrorCode } from "./codes";
import { ZkapAaError, type ZkapAaErrorOptions } from "./ZkapAaError";

export interface AaOperationErrorOptions extends Omit<ZkapAaErrorOptions, "code"> {
  code: ZkapAaOperationErrorCode;
}

/**
 * SDK 내부 실패(Builder/Signer/Config/Crypto 검증·상태). 전체 throw의 대부분.
 * 외부 응답에 의존 안 하므로 base 필드(code/operation/message/cause/timestamp/name)만 사용.
 * 세분은 `code` prefix(INPUT/STATE/ENCODE/SIGNER/CRYPTO/CONFIG)로.
 */
export class AaOperationError extends ZkapAaError {
  declare readonly code: ZkapAaOperationErrorCode;

  constructor(opts: AaOperationErrorOptions) {
    super(opts);
  }
}
