// Base class + shared types
export { ZkapAaError } from "./ZkapAaError";
export type { ZkapAaErrorOptions, DecodedContractError, RevertInfo } from "./ZkapAaError";

// Domain classes
export { UserOpRevertError } from "./UserOpRevertError";
export type { UserOpRevertErrorOptions } from "./UserOpRevertError";
export { AaFetchError } from "./AaFetchError";
export type { AaFetchErrorOptions, FetchService } from "./AaFetchError";
export { AaOperationError } from "./AaOperationError";
export type { AaOperationErrorOptions } from "./AaOperationError";

// Catalogs (objects + array views)
export { AaCode, AaFetchErrorCode, AaOperationErrorCode, AA_CODES, ZKAP_AA_FETCH_CODES, ZKAP_AA_OP_CODES } from "./codes";
export type { ZkapAaFetchErrorCode, ZkapAaOperationErrorCode, ZkapAaCode, UserOpRevertPhase } from "./codes";

// Factories
export { wrapAsOperationUnknown, wrapAsFetchUnknown, wrapAsUserOpRevertUnknown } from "./factories";
export type { UnknownWrapContext } from "./factories";

// Pure code → phase / prefix → code mappings
export { mapAaPrefix, aaCodeToPhase } from "./phase";
