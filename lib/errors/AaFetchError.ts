import type { ZkapAaFetchErrorCode } from "./codes";
import { ZkapAaError, type ZkapAaErrorOptions } from "./ZkapAaError";

export type FetchService = "bundler" | "paymaster" | "swap_aggregator";

export interface AaFetchErrorOptions extends Omit<ZkapAaErrorOptions, "code"> {
  code: ZkapAaFetchErrorCode;
  service: FetchService;
  url: string;
  method: "GET" | "POST";
  httpStatus?: number;
  /** 응답 body 원본(`await res.text()`). HTTP_STATUS/RESPONSE_SHAPE일 때. */
  rawResponse?: string;
}

/**
 * 외부 서비스(bundler/paymaster/1inch) 채널 실패 — 응답을 못 받았거나(transport/timeout)
 * 응답이 의미를 못 갖춤(HTTP 4xx/5xx, 형식 위반). UserOpRevert와 달리 "채널 문제".
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
