/**
 * JSON.stringify 안전 래퍼. bundler/paymaster 응답을 `rawBundlerError`/`rawResponse`에
 * string으로 보존할 때 사용. circular reference·BigInt 등으로 stringify가 throw하면
 * fallback. 직렬화는 throw 시점에 한 번만, 이후로는 string 그대로 다룸.
 */
export function safeStringify(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    const s = JSON.stringify(value);
    if (s !== undefined) return s;
  } catch {
    // circular ref / BigInt 등 → fallback
  }
  try {
    return String(value);
  } catch {
    return "[unstringifiable]";
  }
}
