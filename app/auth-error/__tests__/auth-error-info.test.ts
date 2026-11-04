import { describe, it, expect } from "@jest/globals";
import { getAuthErrorInfo } from "../auth-error-info";

describe("getAuthErrorInfo", () => {
  it("maps known codes to their own key", () => {
    expect(getAuthErrorInfo("400")).toEqual({ key: "400", autoRetry: false });
    expect(getAuthErrorInfo("401")).toEqual({ key: "401", autoRetry: false });
    expect(getAuthErrorInfo("503")).toEqual({ key: "503", autoRetry: false });
  });

  it("auto-retries only on 500 (transient multi-tab race)", () => {
    expect(getAuthErrorInfo("500")).toEqual({ key: "500", autoRetry: true });
  });

  it("falls back to default for unknown, empty, or missing codes", () => {
    expect(getAuthErrorInfo("999")).toEqual({
      key: "default",
      autoRetry: false,
    });
    expect(getAuthErrorInfo("")).toEqual({ key: "default", autoRetry: false });
    expect(getAuthErrorInfo(undefined)).toEqual({
      key: "default",
      autoRetry: false,
    });
    expect(getAuthErrorInfo(null)).toEqual({
      key: "default",
      autoRetry: false,
    });
  });
});
