import {
  ZkapAaError,
  UserOpRevertError,
  AaFetchError,
  AaOperationError,
  AaCode,
  AaFetchErrorCode,
  AaOperationErrorCode,
  OPERATIONS,
  AA_CODES,
  ZKAP_AA_FETCH_CODES,
  ZKAP_AA_OP_CODES,
  wrapAsOperationUnknown,
  wrapAsFetchUnknown,
  wrapAsUserOpRevertUnknown,
} from "../index";
import { safeStringify } from "../../utils/safeStringify";

describe("AaOperationError (base 동작 대표)", () => {
  it("필드/이름/타임스탬프/상속을 채운다", () => {
    const e = new AaOperationError({
      code: AaOperationErrorCode.INPUT_INVALID_ADDRESS,
      operation: "set_sender",
      message: "invalid Ethereum address",
    });
    expect(e).toBeInstanceOf(ZkapAaError);
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe("AaOperationError");
    expect(e.code).toBe("ZKAP_AA_OP_INPUT_INVALID_ADDRESS");
    expect(e.operation).toBe("set_sender");
    expect(e.message).toBe("invalid Ethereum address");
    expect(e.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/); // ISO 8601 UTC
  });

  it("message 생략 시 code로 fallback", () => {
    const e = new AaOperationError({ code: AaOperationErrorCode.UNKNOWN, operation: "init" });
    expect(e.message).toBe("ZKAP_AA_OP_UNKNOWN");
  });

  it("cause는 보존되되 비열거(JSON.stringify 제외)", () => {
    const cause = new TypeError("boom");
    const e = new AaOperationError({ code: AaOperationErrorCode.INPUT_INVALID, operation: "init", cause });
    expect(e.cause).toBe(cause);
    expect(Object.keys(e)).not.toContain("cause");
  });
});

describe("JSON-safe 직렬화", () => {
  it("JSON.stringify가 throw 없이 핵심 필드를 포함", () => {
    const e = new AaFetchError({
      code: AaFetchErrorCode.HTTP_STATUS,
      operation: "request_paymaster_data",
      service: "paymaster",
      url: "https://pm.example/sponsor",
      method: "POST",
      httpStatus: 500,
      rawResponse: '{"err":"down"}',
    });
    const json = JSON.parse(JSON.stringify(e));
    expect(json.name).toBe("AaFetchError");
    expect(json.code).toBe("ZKAP_AA_FETCH_HTTP_STATUS");
    expect(json.operation).toBe("request_paymaster_data");
    expect(json.service).toBe("paymaster");
    expect(json.httpStatus).toBe(500);
    expect(typeof json.timestamp).toBe("string");
  });
});

describe("UserOpRevertError", () => {
  it("phase/contractError/rawRevertData/rawBundlerError를 담는다", () => {
    const e = new UserOpRevertError({
      code: AaCode.AA23_ACCOUNT_REVERTED,
      operation: "submit_user_op",
      phase: "account_validation",
      rawBundlerError: '{"code":-32500,"message":"AA23 reverted"}',
      contractError: { name: "InsufficientTxKeyWeight", args: [] },
      rawRevertData: "0x4f76860e",
    });
    expect(e).toBeInstanceOf(ZkapAaError);
    expect(e.code).toBe("AA23_ACCOUNT_REVERTED");
    expect(e.phase).toBe("account_validation");
    expect(e.contractError).toEqual({ name: "InsufficientTxKeyWeight", args: [] });
    expect(e.rawRevertData).toBe("0x4f76860e");
    expect(e.rawBundlerError).toContain("AA23");
  });

  it("contractError/rawRevertData는 옵셔널 (data 없으면 undefined)", () => {
    const e = new UserOpRevertError({
      code: AaCode.AA21_INSUFFICIENT_PREFUND,
      operation: "submit_user_op",
      phase: "account_validation",
      rawBundlerError: "AA21 didn't pay prefund",
    });
    expect(e.contractError).toBeUndefined();
    expect(e.rawRevertData).toBeUndefined();
  });
});

describe("instanceof 도메인 분기", () => {
  it("base로는 다 잡히고 형제 클래스끼리는 안 잡힌다", () => {
    const rev = new UserOpRevertError({ code: AaCode.UNKNOWN, operation: "submit_user_op", phase: "unknown", rawBundlerError: "x" });
    expect(rev).toBeInstanceOf(ZkapAaError);
    expect(rev).toBeInstanceOf(UserOpRevertError);
    expect(rev).not.toBeInstanceOf(AaFetchError);
    expect(rev).not.toBeInstanceOf(AaOperationError);
  });
});

describe("factories (*_UNKNOWN)", () => {
  it("wrapAsOperationUnknown", () => {
    const e = wrapAsOperationUnknown({ operation: "init", message: "weird" });
    expect(e).toBeInstanceOf(AaOperationError);
    expect(e.code).toBe("ZKAP_AA_OP_UNKNOWN");
  });
  it("wrapAsFetchUnknown", () => {
    const e = wrapAsFetchUnknown({ operation: "rpc_call", service: "bundler", url: "u", method: "POST" });
    expect(e.code).toBe("ZKAP_AA_FETCH_UNKNOWN");
    expect(e.service).toBe("bundler");
  });
  it("wrapAsUserOpRevertUnknown — phase 기본 unknown", () => {
    const e = wrapAsUserOpRevertUnknown({ operation: "submit_user_op", rawBundlerError: "raw" });
    expect(e.code).toBe("AA_UNKNOWN");
    expect(e.phase).toBe("unknown");
  });
});

describe("catalog 무결성", () => {
  it("배열 view 길이", () => {
    expect(AA_CODES).toHaveLength(25);
    expect(ZKAP_AA_FETCH_CODES).toHaveLength(5);
    expect(ZKAP_AA_OP_CODES).toHaveLength(39);
  });
  it("코드 값 유일성", () => {
    expect(new Set(ZKAP_AA_OP_CODES).size).toBe(ZKAP_AA_OP_CODES.length);
    expect(new Set(AA_CODES).size).toBe(AA_CODES.length);
  });
  it("OPERATIONS는 닫힌 카탈로그 + 명명 정규화 적용", () => {
    expect(OPERATIONS).toContain("init"); // constructor 통일
    expect(OPERATIONS).toContain("do_init"); // _doInit prefix 제거
    expect(OPERATIONS).toContain("estimate_user_op_gas");
    expect(new Set(OPERATIONS).size).toBe(OPERATIONS.length); // 충돌 없음
  });
});

describe("safeStringify", () => {
  it("정상 객체 → JSON", () => {
    expect(safeStringify({ a: 1 })).toBe('{"a":1}');
  });
  it("string은 그대로", () => {
    expect(safeStringify("hello")).toBe("hello");
  });
  it("circular ref → throw 없이 fallback string", () => {
    const o: Record<string, unknown> = {};
    o.self = o;
    expect(typeof safeStringify(o)).toBe("string");
  });
  it("BigInt 포함 → throw 없이 fallback", () => {
    expect(typeof safeStringify({ n: 10n })).toBe("string");
  });
});
