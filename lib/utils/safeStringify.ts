/**
 * Safe JSON.stringify wrapper. Used to preserve bundler/paymaster responses as a
 * string in `rawBundlerError` / `rawResponse`. If stringify throws (circular ref,
 * BigInt, etc.) it falls back. Serialize once at throw time, then keep the string.
 */
export function safeStringify(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    const s = JSON.stringify(value);
    if (s !== undefined) return s;
  } catch {
    // circular ref / BigInt / etc. → fall back
  }
  try {
    return String(value);
  } catch {
    return "[unstringifiable]";
  }
}
