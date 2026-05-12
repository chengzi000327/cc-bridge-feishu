import { describe, expect, it } from "vitest";
import { assertFeishuToken, parseFeishuEventBody } from "../src/feishu/crypto.js";

describe("feishu crypto", () => {
  it("accepts matching verification token", () => {
    expect(() => assertFeishuToken({ token: "expected" }, "expected")).not.toThrow();
  });

  it("accepts matching verification token from event header", () => {
    expect(() => assertFeishuToken({ header: { token: "expected" } }, "expected")).not.toThrow();
  });

  it("rejects mismatched verification token", () => {
    expect(() => assertFeishuToken({ token: "bad" }, "expected")).toThrow("Invalid Feishu verification token");
  });

  it("returns plain body when encrypt key is absent", () => {
    const body = { token: "t", event: { ok: true } };
    expect(parseFeishuEventBody(body, { verificationToken: "t" })).toEqual(body);
  });

  it("reports encrypted payloads when encrypt key is absent", () => {
    expect(() => parseFeishuEventBody({ encrypt: "abc" }, { verificationToken: "t" }))
      .toThrow("Feishu encrypted event received but FEISHU_ENCRYPT_KEY is not configured");
  });
});
