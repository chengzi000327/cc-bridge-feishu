export interface RetryConfig {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

function isTransientProviderError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /rate limit|timeout|temporar|ECONNRESET|ETIMEDOUT|502|503|504/i.test(message);
}

async function delay(ms: number): Promise<void> {
  if (ms <= 0) {
    return;
  }
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runWithProviderRetry<T>(
  config: RetryConfig,
  fn: (attempt: number) => Promise<T>,
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= config.maxAttempts; attempt += 1) {
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;
      if (attempt >= config.maxAttempts || !isTransientProviderError(error)) {
        throw error;
      }

      const backoffMs = Math.min(config.maxDelayMs, config.baseDelayMs * 2 ** (attempt - 1));
      await delay(backoffMs);
    }
  }

  throw lastError;
}
