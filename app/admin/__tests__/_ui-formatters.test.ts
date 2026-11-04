import { describe, it, expect } from "@jest/globals";
import { fmtUSD, formatDateTime } from "../_ui";

describe("fmtUSD (single honest money policy)", () => {
  it("uses 2 decimals from $1 up (clean aggregates)", () => {
    expect(fmtUSD(12.3456)).toBe("$12.35");
    expect(fmtUSD(1)).toBe("$1.00");
    expect(fmtUSD(1000)).toBe("$1000.00");
  });

  it("uses 4 decimals below $1 so sub-cent is not hidden as $0.00", () => {
    expect(fmtUSD(0.0034)).toBe("$0.0034");
    expect(fmtUSD(0.5)).toBe("$0.5000");
  });

  it("handles negatives and non-finite", () => {
    expect(fmtUSD(-5)).toBe("-$5.00");
    expect(fmtUSD(-0.002)).toBe("-$0.0020");
    expect(fmtUSD(Number.NaN)).toBe("$0");
  });
});

describe("formatDateTime", () => {
  it("includes the year (the audit trail must be unambiguous across years)", () => {
    expect(formatDateTime(Date.UTC(2026, 9, 31, 14, 30))).toMatch(/2026/);
  });

  it("renders a dash for empty/missing timestamps", () => {
    expect(formatDateTime(null)).toBe("—");
    expect(formatDateTime(0)).toBe("—");
    expect(formatDateTime(undefined)).toBe("—");
  });
});
