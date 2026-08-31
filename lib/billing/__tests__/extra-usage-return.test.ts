import { describe, expect, it } from "@jest/globals";
import { getExtraUsageReturnUrl } from "../extra-usage-return";

describe("getExtraUsageReturnUrl", () => {
  it("preserves a same-origin chat path and its query", () => {
    expect(
      getExtraUsageReturnUrl(
        "https://ai.suricatoos.com",
        "/chat-123?view=task",
      ).toString(),
    ).toBe("https://ai.suricatoos.com/chat-123?view=task");
  });

  it.each([undefined, "https://evil.example", "//evil.example/path"])(
    "falls back to the origin for unsafe return path %s",
    (returnPath) => {
      expect(
        getExtraUsageReturnUrl("https://ai.suricatoos.com", returnPath).toString(),
      ).toBe("https://ai.suricatoos.com/");
    },
  );
});
