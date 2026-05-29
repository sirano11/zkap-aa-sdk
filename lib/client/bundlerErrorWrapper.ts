import { ethers } from "ethers";

import {
  AaCode,
  AaFetchErrorCode,
  AaFetchError,
  UserOpRevertError,
  aaCodeToPhase,
  mapAaPrefix,
  type FetchService,
} from "../errors";
import { decodeContractError } from "./revertDecoder";

// ---------------------------------------------------------------------------
// fetch() throw → TRANSPORT / TIMEOUT
// ---------------------------------------------------------------------------
export function makeFetchTransportError(
  err: unknown,
  ctx: { service: FetchService; url: string; method: "GET" | "POST"; operation: string },
): AaFetchError {
  const isTimeout = err instanceof DOMException && err.name === "AbortError";
  return new AaFetchError({
    code: isTimeout ? AaFetchErrorCode.TIMEOUT : AaFetchErrorCode.TRANSPORT,
    cause: err,
    service: ctx.service,
    url: ctx.url,
    method: ctx.method,
    operation: ctx.operation,
  });
}

// ---------------------------------------------------------------------------
// classifyBundlerError — 3-way, always returns an error, always preserves raw
// ---------------------------------------------------------------------------
export interface ClassifyBundlerErrorOpts {
  /** Text to scan for an AA prefix (JSON-RPC error.message or REST body). */
  text: string;
  /** JSON-RPC error.data (revert bytes), when present. */
  data?: unknown;
  /** HTTP status, when the failure came with one (REST !res.ok). */
  httpStatus?: number;
  /** Pre-stringified original response — always preserved. */
  raw: string;
  operation: string;
  service: FetchService;
  url: string;
  method: "GET" | "POST";
}

/**
 * Classifies a bundler error response. Each provider extracts the normalized
 * fields from its own transport; the rules live here.
 *
 *  1. AA prefix present        → UserOpRevertError (validation, AaCode + phase)
 *  2. no AA but revert data    → UserOpRevertError (execution, AA_UNKNOWN)
 *  3. otherwise                → AaFetchError (channel)
 *
 * Raw is preserved in every branch (rawBundlerError / rawResponse).
 */
export function classifyBundlerError(opts: ClassifyBundlerErrorOpts): UserOpRevertError | AaFetchError {
  // opts.data is untrusted bundler payload — only treat it as revert bytes when it is
  // a hex string with a full selector. decodeContractError requires that by contract.
  const revertData = ethers.isHexString(opts.data) && (opts.data as string).length >= 10
    ? (opts.data as `0x${string}`)
    : undefined;
  const contractError = revertData ? decodeContractError(revertData).contractError : undefined;
  const rawRevertData = revertData;

  // 1) AA prefix → validation-phase rejection
  const aa = mapAaPrefix(opts.text);
  if (aa) {
    return new UserOpRevertError({
      code: aa,
      phase: aaCodeToPhase(aa),
      operation: opts.operation,
      contractError,
      rawRevertData,
      rawBundlerError: opts.raw,
      message: opts.text,
    });
  }

  // 2) no AA prefix but revert data/reason present → execution-phase revert
  const looksLikeRevert = !!revertData || /reverted|execution reverted/i.test(opts.text);
  if (looksLikeRevert) {
    return new UserOpRevertError({
      code: AaCode.UNKNOWN,
      phase: "execution",
      operation: opts.operation,
      contractError,
      rawRevertData,
      rawBundlerError: opts.raw,
      message: opts.text || "Execution reverted",
    });
  }

  // 3) genuine channel / response problem
  return new AaFetchError({
    // 4xx vs 5xx distinction is preserved on httpStatus; the consumer decides retry policy.
    code: opts.httpStatus != null ? AaFetchErrorCode.HTTP_STATUS : AaFetchErrorCode.RESPONSE_SHAPE,
    httpStatus: opts.httpStatus,
    service: opts.service,
    url: opts.url,
    method: opts.method,
    operation: opts.operation,
    rawResponse: opts.raw,
    message: opts.httpStatus != null ? `Bundler returned HTTP ${opts.httpStatus}` : "Unexpected bundler response",
  });
}
