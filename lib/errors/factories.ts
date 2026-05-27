import { AaCode, AaFetchErrorCode, AaOperationErrorCode, type OperationType, type UserOpRevertPhase } from "./codes";
import { AaFetchError, type FetchService } from "./AaFetchError";
import { AaOperationError } from "./AaOperationError";
import { UserOpRevertError } from "./UserOpRevertError";

/**
 * `*_UNKNOWN` 팩토리. throw 사이트를 특정 code에 매핑 못 할 때(분류 불가 새 패턴)
 * boilerplate를 줄이기 위함. UNKNOWN으로 throw할 땐 message/raw에 진단 정보 보존 의무.
 */
export interface UnknownWrapContext {
  operation: OperationType;
  cause?: unknown;
  message?: string;
}

export function wrapAsOperationUnknown(ctx: UnknownWrapContext): AaOperationError {
  return new AaOperationError({
    code: AaOperationErrorCode.UNKNOWN,
    operation: ctx.operation,
    cause: ctx.cause,
    message: ctx.message,
  });
}

export function wrapAsFetchUnknown(
  ctx: UnknownWrapContext & {
    service: FetchService;
    url: string;
    method: "GET" | "POST";
    httpStatus?: number;
    rawResponse?: string;
  },
): AaFetchError {
  return new AaFetchError({
    code: AaFetchErrorCode.UNKNOWN,
    operation: ctx.operation,
    service: ctx.service,
    url: ctx.url,
    method: ctx.method,
    httpStatus: ctx.httpStatus,
    rawResponse: ctx.rawResponse,
    cause: ctx.cause,
    message: ctx.message,
  });
}

export function wrapAsUserOpRevertUnknown(
  ctx: UnknownWrapContext & { rawBundlerError: string; phase?: UserOpRevertPhase },
): UserOpRevertError {
  return new UserOpRevertError({
    code: AaCode.UNKNOWN,
    operation: ctx.operation,
    phase: ctx.phase ?? "unknown",
    rawBundlerError: ctx.rawBundlerError,
    cause: ctx.cause,
    message: ctx.message,
  });
}
