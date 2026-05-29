import receiptsJson from "./fixtures/revert-receipts.json";
import { decodeContractError } from "../revertDecoder";

/**
 * Revert decode against the revert bytes from REAL Base Sepolia receipts (4 reverted
 * UserOps). The full receipt-logs → reason → ReceiptRevert path is exercised in the
 * provider tests; here we validate decodeContractError on the captured reason bytes.
 * RPC used to capture: sepolia.base.org.
 */
type RevertFixture = {
  txHash: string;
  note: string;
  success: boolean;
  revertReason: string;
  expect: { name: string; args: unknown[] } | null;
  logs: { topics: string[]; data: string }[];
};

const fixtures = receiptsJson as RevertFixture[];

describe("revertDecoder against real Base Sepolia receipts", () => {
  it("has 4 captured reverted-UserOp fixtures", () => {
    expect(fixtures).toHaveLength(4);
    expect(fixtures.every((f) => f.success === false)).toBe(true);
  });

  it.each(fixtures)("decodeContractError — $note", (fx) => {
    // decode the captured revert bytes — always a RevertInfo (selector + raw preserved)
    const decoded = decodeContractError(fx.revertReason);
    expect(decoded.selector).toBe(fx.revertReason.slice(0, 10));
    expect(decoded.rawRevertData).toBe(fx.revertReason);
    if (fx.expect === null) {
      // unknown target selector → SDK can't decode; caller keeps raw + selector only
      expect(decoded.contractError).toBeUndefined();
    } else {
      expect(decoded.contractError).toEqual(fx.expect);
    }

    // whatever we produce must stay JSON-safe
    expect(() => JSON.stringify(decoded)).not.toThrow();
  });
});
