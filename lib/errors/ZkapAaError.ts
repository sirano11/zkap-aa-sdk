import type { OperationType, ZkapAaCode } from "./codes";

/**
 * SDK ABI(EntryPoint+ZkapAccount+ZkapPaymaster)로 디코드된 컨트랙트 커스텀 에러.
 * 표준 `Error(string)`/`Panic(uint256)`도 ethers가 디코드하므로 여기 담김.
 */
export interface DecodedContractError {
  /** 커스텀 에러 이름 (예: "InsufficientTxKeyWeight", "Error", "Panic"). */
  name: string;
  /** 에러 인자. 인자 없는 커스텀 에러면 빈 배열. */
  args: unknown[];
}

/**
 * revert 정보 공통 묶음. `UserOpRevertError`(validation/estimate throw)와
 * `UserOpReceipt`(execution 결과)가 공유.
 */
export interface RevertInfo {
  /** 디코드 성공 시. SDK가 모르는 selector면 undefined. */
  contractError?: DecodedContractError;
  /** 4-byte selector(`0x`+8hex). 디코드 실패해도 매칭/그룹핑용. */
  selector?: string;
  /** 원본 revert bytes. consumer가 자기 타겟 ABI로 디코드. */
  rawRevertData?: string;
}

export interface ZkapAaErrorOptions {
  /** 하위 클래스에서 union으로 좁힘(AaCode / ZkapAaFetchErrorCode / ...). */
  code: ZkapAaCode;
  /** throw 발생 함수명(snake_case). 닫힌 OPERATIONS 카탈로그. */
  operation: OperationType;
  message?: string;
  cause?: unknown;
}

/**
 * zkap-aa-sdk 라이브러리 루트 sentinel. 모든 라이브러리 throw가 이를 상속 →
 * consumer는 `e instanceof ZkapAaError`로 출처를 한 줄 판별.
 *
 * abstract — 직접 생성 금지. `UserOpRevertError`/`AaFetchError`/`AaOperationError` 사용.
 * 패턴은 `zkap-bank/src/errors/ZkapBankError.ts`에 정렬.
 */
export abstract class ZkapAaError extends Error {
  readonly code: ZkapAaCode;
  readonly operation: OperationType;
  /** ES2022 Error.cause. 생성자에서 own property로 설정(es2020 lib 타입 보강용 declare). */
  declare readonly cause?: unknown;
  /**
   * throw 시각 ISO 8601 UTC(`2026-05-22T14:30:45.123Z`). 생성자 자동 부여.
   * 라이브러리 throw 시점이지 Crashlytics 업로드 시점(지연 가능)이 아님.
   */
  readonly timestamp: string;

  constructor(opts: ZkapAaErrorOptions) {
    super(opts.message ?? opts.code);
    this.name = new.target.name; // 하위 클래스명 자동(예: "UserOpRevertError")
    this.code = opts.code;
    this.operation = opts.operation;
    this.timestamp = new Date().toISOString();
    // ES2022 Error.cause — tsconfig lib(es2020)에 타입이 없고 RN Hermes 등 구환경
    // 호환을 위해 생성자 2-arg 대신 own property로 설정. 비열거(JSON.stringify 제외).
    if (opts.cause !== undefined) {
      Object.defineProperty(this, "cause", { value: opts.cause, writable: true, configurable: true });
    }
  }
}
