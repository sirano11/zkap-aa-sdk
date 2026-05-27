// Base sentinel + 공유 타입
export { ZkapAaError } from "./ZkapAaError";
export type { ZkapAaErrorOptions, DecodedContractError, RevertInfo } from "./ZkapAaError";

// 도메인 클래스
export { UserOpRevertError } from "./UserOpRevertError";
export type { UserOpRevertErrorOptions } from "./UserOpRevertError";
export { AaFetchError } from "./AaFetchError";
export type { AaFetchErrorOptions, FetchService } from "./AaFetchError";
export { AaOperationError } from "./AaOperationError";
export type { AaOperationErrorOptions } from "./AaOperationError";

// 카탈로그 (객체 + 배열 view)
export { AaCode, AaFetchErrorCode, AaOperationErrorCode, OPERATIONS, AA_CODES, ZKAP_AA_FETCH_CODES, ZKAP_AA_OP_CODES } from "./codes";
export type { ZkapAaFetchErrorCode, ZkapAaOperationErrorCode, ZkapAaCode, UserOpRevertPhase, OperationType } from "./codes";

// 팩토리
export { wrapAsOperationUnknown, wrapAsFetchUnknown, wrapAsUserOpRevertUnknown } from "./factories";
export type { UnknownWrapContext } from "./factories";
