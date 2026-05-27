import { AaCode, AaFetchErrorCode, AaOperationErrorCode, type OperationType, type UserOpRevertPhase } from "./codes";
import { AaFetchError, type FetchService } from "./AaFetchError";
import { AaOperationError } from "./AaOperationError";
import { UserOpRevertError } from "./UserOpRevertError";

/**
 * `*_UNKNOWN` factories. Use when a throw site cannot be mapped to a specific code
 * yet (an unclassified new pattern) and you want to collapse boilerplate. When
 * throwing UNKNOWN, preserve diagnostic context in `message`/raw fields.
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
