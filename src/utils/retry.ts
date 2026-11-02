/**
 * Retry an async operation with exponential backoff.
 */
export async function retry<T>(
  fn: () => Promise<T>,
  attempts: number = 2,
  delayMs: number = 1000
): Promise<T> {
  let lastError: Error | undefined;

  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (i < attempts - 1) {
        await new Promise((r) => setTimeout(r, delayMs * (i + 1)));
      }
    }
  }

  throw lastError;
}
