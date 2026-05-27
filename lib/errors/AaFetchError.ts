import type { ZkapAaFetchErrorCode } from "./codes";
import { ZkapAaError, type ZkapAaErrorOptions } from "./ZkapAaError";

export type FetchService = "bundler" | "paymaster" | "swap_aggregator";

export interface AaFetchErrorOptions extends Omit<ZkapAaErrorOptions, "code"> {
  code: ZkapAaFetchErrorCode;
  service: FetchService;
  url: string;
  method: "GET" | "POST";
  httpStatus?: number;
  /** Original response body (`await res.text()`). Set for HTTP_STATUS / RESPONSE_SHAPE. */
  rawResponse?: string;
}

/**
 * External service (bundler / paymaster / 1inch) channel failure — no response
 * received (transport/timeout) or a response that carries no meaning (HTTP 4xx/5xx,
 * shape violation). Unlike UserOpRevert this is a "channel problem".
 */
export class AaFetchError extends ZkapAaError {
  declare readonly code: ZkapAaFetchErrorCode;
  readonly service: FetchService;
  readonly url: string;
  readonly method: "GET" | "POST";
  readonly httpStatus?: number;
  readonly rawResponse?: string;

  constructor(opts: AaFetchErrorOptions) {
    super(opts);
    this.service = opts.service;
    this.url = opts.url;
    this.method = opts.method;
    this.httpStatus = opts.httpStatus;
    this.rawResponse = opts.rawResponse;
  }
}
