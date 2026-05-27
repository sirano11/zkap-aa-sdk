import type { ZkapAaOperationErrorCode } from "./codes";
import { ZkapAaError, type ZkapAaErrorOptions } from "./ZkapAaError";

export interface AaOperationErrorOptions extends Omit<ZkapAaErrorOptions, "code"> {
  code: ZkapAaOperationErrorCode;
}

/**
 * Internal SDK failure (Builder / Signer / Config / Crypto validation or state) —
 * the majority of throw sites. Does not depend on an external response, so it uses
 * only the base fields (code/operation/message/cause/timestamp/name). Sub-categorized
 * by `code` prefix (INPUT / STATE / ENCODE / SIGNER / CRYPTO / CONFIG).
 */
export class AaOperationError extends ZkapAaError {
  declare readonly code: ZkapAaOperationErrorCode;

  constructor(opts: AaOperationErrorOptions) {
    super(opts);
  }
}
