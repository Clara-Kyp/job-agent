import { mkdirSync, mkdtempSync, readlinkSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { chromium, type BrowserContext } from "playwright";

type LaunchOptions = NonNullable<Parameters<typeof chromium.launchPersistentContext>[1]>;

function profileInUse(profileDir: string): boolean {
  try {
    const lockTarget = readlinkSync(join(profileDir, "SingletonLock"));
    const pid = Number(lockTarget.match(/-(\d+)$/)?.[1]);
    if (!Number.isInteger(pid) || pid <= 0) return false;
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Keep an open review window from locking the profile needed by the next run. */
export async function launchReviewBrowser(profileDir: string, options: LaunchOptions): Promise<BrowserContext> {
  mkdirSync(profileDir, { recursive: true, mode: 0o700 });
  if (!profileInUse(profileDir)) {
    try {
      return await chromium.launchPersistentContext(profileDir, options);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/Target page, context or browser has been closed|existing browser session|正在现有的浏览器会话中打开/i.test(message)) throw error;
    }
  }

  const runsDir = join(dirname(profileDir), "browser-runs");
  mkdirSync(runsDir, { recursive: true, mode: 0o700 });
  const isolatedDir = mkdtempSync(join(runsDir, "review-"));
  try {
    const context = await chromium.launchPersistentContext(isolatedDir, options);
    context.once("close", () => {
      try { rmSync(isolatedDir, { recursive: true, force: true }); } catch { /* Browser may still be releasing files. */ }
    });
    console.log("  🌐 Existing review browser remains open; this run uses a separate Chrome profile.");
    return context;
  } catch (error) {
    rmSync(isolatedDir, { recursive: true, force: true });
    throw error;
  }
}
