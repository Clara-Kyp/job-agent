/**
 * WebcmdSession — replaces the direct Playwright BrowserSession.
 *
 * All browser interaction happens inside webcmd's QuickJS sandbox through
 * `browser run` programs, so this class NEVER exposes a Playwright `Page`.
 * The public surface mirrors the old `BrowserSession` so the rest of the
 * pipeline (index.ts, form-analyzer.ts, form-filler.ts) only needs mechanical
 * rewires.
 */

import { cfg } from "../config.js";
import { resolve } from "node:path";
import { type BrowserContext, type Page } from "playwright";
import { launchReviewBrowser } from "./review-browser.js";
import {
  webcmdExec,
  ensureDaemon,
  createSession,
  closeSession,
  runBrowserProgram,
  takeSnapshot,
  WebcmdCliError,
  type WebcmdRunResult,
  type WebcmdSessionInfo,
} from "./webcmd-cli.js";
import {
  gotoProgram,
  getTabsProgram,
  closeWindowProgram,
} from "./webcmd-programs.js";

export interface WebcmdSnapshot {
  [key: string]: unknown;
}

export class WebcmdSession {
  private profile: string;
  private profileReady = false;
  private sessionId: string | null = null;
  private sessionName: string | null = null;
  private closed = false;
  private fallbackContext: BrowserContext | null = null;
  private fallbackPage: Page | null = null;
  private successfulPrograms = 0;

  constructor(
    profile = cfg.webcmdProfile,
    private readonly sessionBaseName = "applyflow",
    private readonly preferLocalBrowser = false
  ) {
    this.profile = profile;
  }

  /** The readable webcmd Session ID, once created. */
  get id(): string | null {
    return this.sessionId;
  }

  /** True once the session has been created and is usable. */
  get isLaunched(): boolean {
    return !this.closed && (this.sessionId !== null || this.fallbackContext !== null);
  }

  /**
   * Ensure the daemon is up and create a fresh session.
   * Idempotent — safe to call multiple times (reuses the existing session).
   */
  async launch(): Promise<void> {
    if (this.isLaunched) {
      console.log("  🌐 Reusing existing webcmd session");
      return;
    }

    if (this.preferLocalBrowser) {
      await this.launchFallback();
      return;
    }

    try {
      await this.ensureProfile();
      const name = this.makeSessionName();
      console.log(`  🌐 Creating webcmd session "${name}"...`);
      const info = await createSession(name);
      this.sessionId = info.id;
      this.sessionName = name;
      console.log(`  ✅ Session ready: ${info.id} (${info.kind} / ${info.runtimeState})`);
    } catch (error) {
      console.warn("  ⚠️  webcmd unavailable; opening a dedicated Playwright browser.");
      await this.launchFallback();
    }
  }

  private async launchFallback(): Promise<void> {
    const userDataDir = resolve(process.cwd(), "data/private/browser-profile");
    this.fallbackContext = await launchReviewBrowser(userDataDir, {
      channel: "chrome",
      headless: cfg.headless,
      acceptDownloads: true,
    });
    this.fallbackPage = this.fallbackContext.pages()[0] || await this.fallbackContext.newPage();
    this.closed = false;
  }

  private async runFallback(program: string): Promise<WebcmdRunResult> {
    const page = this.fallbackPage;
    const context = this.fallbackContext;
    if (!page || !context) throw new WebcmdCliError("BROWSER_UNAVAILABLE", "Fallback browser is not open.");
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as
      new (...args: string[]) => (...values: unknown[]) => Promise<unknown>;
    const result = await new AsyncFunction("page", "context", "browser", "console", program)(
      page, context, context.browser(), console,
    );
    this.successfulPrograms++;
    return {
      ok: true,
      result,
      logs: [],
      page: { id: "playwright-fallback", url: page.url(), title: await page.title() },
      artifacts: [], warnings: [],
      limits: { outputTruncated: false, snapshotTruncated: false },
      timings: {},
    };
  }

  /**
   * Ensure the webcmd profile exists and the daemon is healthy.
   * `webcmd doctor` auto-boots the daemon; `profile create` is idempotent.
   */
  private async ensureProfile(): Promise<void> {
    if (this.profileReady) return;

    const report = await ensureDaemon();
    if (!report.ok) {
      throw new WebcmdCliError(
        "DAEMON_UNAVAILABLE",
        "webcmd daemon is not reachable",
        report.error
      );
    }

    // Idempotent profile creation — creating an existing profile is a no-op.
    const profileArgs = ["--profile", this.profile, "profile", "create", this.profile, "-f", "json"];
    try {
      await webcmdExec(profileArgs, 30_000);
    } catch {
      // Profile likely already exists; daemon doctor passed so proceed.
    }

    this.profileReady = true;
  }

  /** Human-readable, unique session base name. */
  private makeSessionName(): string {
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
    return `${this.sessionBaseName}-${stamp}`;
  }

  /**
   * Navigate to a URL and wait for the page to settle.
   */
  async navigate(url: string): Promise<void> {
    this.requireSession();
    console.log(`  🔗 Navigating to: ${url}`);

    const result = await this.runProgram(gotoProgram(url));
    const pageInfo = result.page as { url?: string; title?: string };
    console.log(`  ✅ Page loaded: ${pageInfo.url || url}`);
  }

  /**
   * Run an arbitrary webcmd browser program against this session.
   * This is the single choke point every analyzer/filler operation funnels
   * through, with a small retry for transient SESSION_BUSY contention.
   */
  async runProgram(
    program: string,
    opts: { timeoutMs?: number; maxOutputChars?: number } = {}
  ): Promise<WebcmdRunResult> {
    this.requireSession();
    if (this.fallbackContext) return this.runFallback(program);

    const timeoutMs = opts.timeoutMs ?? 30_000;
    const attempts = 4;

    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        const result = await runBrowserProgram(this.sessionId!, program, timeoutMs, opts.maxOutputChars);
        this.successfulPrograms++;
        return result;
      } catch (err: unknown) {
        const busy = err instanceof WebcmdCliError && err.code === "SESSION_BUSY";
        // Newly created CloakBrowser sessions can report a stale CDP endpoint
        // before the browser is ready. This error occurs before the program
        // starts, so retrying cannot duplicate a form write.
        const connecting = err instanceof WebcmdCliError &&
          /connectOverCDP.*404 Not Found|WebSocket error:.*404 Not Found/s.test(`${err.message}\n${err.hint || ""}`);
        if (attempt >= attempts || (!busy && !connecting)) {
          if (connecting && this.successfulPrograms === 0) {
            await closeSession(this.sessionId!).catch(() => {});
            this.sessionId = null;
            await this.launchFallback();
            return this.runFallback(program);
          }
          throw err;
        }
        await new Promise((r) => setTimeout(r, connecting ? 1000 * attempt : 500));
      }
    }
    throw new WebcmdCliError("BROWSER_RUN_ERROR", "browser run failed");
  }

  /**
   * Take a snapshot of the current page (webcmd accessibility tree).
   */
  async snapshot(mode: "act" | "tree" | "read" = "act"): Promise<WebcmdSnapshot> {
    this.requireSession();
    if (this.fallbackPage) return { text: await this.fallbackPage.locator("body").innerText() };
    return (await takeSnapshot(this.sessionId!, mode)) as WebcmdSnapshot;
  }

  /**
   * List open tabs in the session (diagnostics).
   */
  async getTabs(): Promise<Array<{ url: string; title: string }>> {
    this.requireSession();
    const result = await this.runProgram(getTabsProgram());
    const tabs = (result.result as { tabs?: Array<{ url: string; title: string }> })?.tabs ?? [];
    return tabs;
  }

  /**
   * Close the current page/tab (keep the session alive).
   */
  async closeWindow(): Promise<void> {
    if (!this.sessionId) return;
    await this.runProgram(closeWindowProgram()).catch(() => {});
  }

  /**
   * Close the session gracefully. Safe to call multiple times.
   * The daemon stays alive for reuse.
   */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;

    if (this.fallbackContext) {
      await this.fallbackContext.close();
      this.fallbackContext = null;
      this.fallbackPage = null;
      return;
    }
    if (!this.sessionId) return;

    console.log("  🔒 Closing webcmd session...");
    await closeSession(this.sessionId).catch(() => {});
    this.sessionId = null;
  }

  /** Require an active session or throw a helpful error. */
  private requireSession(): void {
    if (this.closed) {
      throw new WebcmdCliError("SESSION_CLOSED", "WebcmdSession is closed");
    }
    if (!this.sessionId && !this.fallbackContext) {
      throw new WebcmdCliError(
        "SESSION_NOT_LAUNCHED",
        "WebcmdSession not launched. Call launch() before browser operations."
      );
    }
  }
}
