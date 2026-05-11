import { describe, expect, it } from "vitest";

import { runWithProviderRetry } from "../src/provider/retry.js";

describe("runWithProviderRetry", () => {
  it("returns first success", async () => {
    const result = await runWithProviderRetry(
      { maxAttempts: 3, baseDelayMs: 0, maxDelayMs: 0 },
      async (attempt) => `ok-${attempt}`,
    );

    expect(result).toBe("ok-1");
  });

  it("retries transient failures", async () => {
    let attempts = 0;

    const result = await runWithProviderRetry(
      { maxAttempts: 3, baseDelayMs: 0, maxDelayMs: 0 },
      async (attempt) => {
        attempts = attempt;
        if (attempt < 3) {
          throw new Error("rate limit");
        }
        return "ok";
      },
    );

    expect(result).toBe("ok");
    expect(attempts).toBe(3);
  });

  it.each([
    "rate limit exceeded",
    "request timeout",
    "temporary provider failure",
    "read ECONNRESET",
    "connect ETIMEDOUT",
    "upstream returned 502",
    "upstream returned 503",
    "upstream returned 504",
  ])("treats %s as transient", async (message) => {
    let attempts = 0;

    const result = await runWithProviderRetry(
      { maxAttempts: 2, baseDelayMs: 0, maxDelayMs: 0 },
      async () => {
        attempts += 1;
        if (attempts === 1) {
          throw new Error(message);
        }
        return "ok";
      },
    );

    expect(result).toBe("ok");
    expect(attempts).toBe(2);
  });

  it("throws non-retryable errors immediately", async () => {
    let attempts = 0;
    const error = new Error("invalid api key");

    await expect(
      runWithProviderRetry(
        { maxAttempts: 3, baseDelayMs: 0, maxDelayMs: 0 },
        async () => {
          attempts += 1;
          throw error;
        },
      ),
    ).rejects.toBe(error);

    expect(attempts).toBe(1);
  });
});
