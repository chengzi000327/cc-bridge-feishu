import { describe, expect, it } from "vitest";
import { getConversationKey } from "../src/transport/conversation-key.js";

describe("getConversationKey", () => {
  it("builds a direct conversation key", () => {
    expect(getConversationKey({ platform: "feishu", chatId: "oc_1", threadId: undefined })).toBe("feishu:oc_1");
  });

  it("builds a thread conversation key", () => {
    expect(getConversationKey({ platform: "feishu", chatId: "oc_1", threadId: "om_2" })).toBe("feishu:oc_1:om_2");
  });
});
