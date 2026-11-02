/**
 * Thin CLI wrapper for the webcmd binary.
 *
 * Every webcmd interaction goes through a subprocess call to the CLI.
 * This module handles:
 *  - Resolving the webcmd binary path
 *  - Spawning CLI commands with timeout
 *  - Parsing JSON output
 *  - Throwing typed errors on failure
 *  - Ensuring the daemon is running (doctor check)
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { cfg } from "../config.js";

const execFileAsync = promisify(execFile);

// ─── Binary Resolution ────────────────────────────────────────────────────────

/**
 * Resolve how to invoke the webcmd CLI.
 * Priority: WEBCMD_PATH env → project-local webcmd/dist/src/main.js → global `webcmd`.
 *
 * Returns `{ cmd, args }` where `cmd` is the executable to spawn and `args` is
 * any fixed leading argv (e.g. `["/abs/path/…/main.js"]` for node invocations).
 */
function resolveBinary(): { cmd: string; args: string[] } {
  let target = cfg.webcmdBinary;

  if (!target) {
    // Project-local: webcmd is vendored inside the ATS repo
    const localPath = resolve(process.cwd(), "webcmd", "dist", "src", "main.js");
    target = existsSync(localPath) ? localPath : "webcmd";
  }

  target = target.trim();

  // Bare launcher names run directly.
  if (target === "webcmd" || target === "npx" || target === "bunx" || target === "tsx") {
    return { cmd: target, args: [] };
  }

  // A `.js`/`.mjs`/`.cjs` entry point must be executed by Node itself on Windows.
  if (/\.(?:c|m)?js$/i.test(target)) {
    return { cmd: "node", args: [target] };
  }

  // Otherwise treat it as a path to an executable.
  return { cmd: target, args: [] };
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface WebcmdRunResult {
  ok: true;
  result: unknown;
  logs: Array<{ level: string; args: unknown[] }>;
  page: { id: string; url: string; title: string };
  snapshotDiff?: string;
  artifacts: unknown[];
  warnings: unknown[];
  limits: { outputTruncated: boolean; snapshotTruncated: boolean };
  timings: Record<string, number>;
}

export interface WebcmdSessionInfo {
  id: string;
  kind: string;
  runtimeState: string;
}

export interface WebcmdCloseResult {
  closed: boolean;
  alreadyIdle?: boolean;
  session: string;
}

export interface WebcmdDoctorReport {
  /** Derived: daemon reachable + runtime connected + browser binary present. */
  ok: boolean;
  daemonRunning?: boolean;
  runtimeConnected?: boolean;
  binary?: { installed?: boolean; path?: string };
  error?: string;
}

// ─── Core CLI Call ────────────────────────────────────────────────────────────

/**
 * Execute a webcmd CLI command and return parsed JSON output.
 *
 * @param args - CLI arguments (e.g. ["--profile", "applyflow", "session", "create", "test"])
 * @param timeoutMs - Max execution time (default 60s)
 * @returns Parsed JSON output from stdout
 */
export async function webcmdExec(
  args: string[],
  timeoutMs = 60_000
): Promise<unknown> {
  const { cmd, args: binArgs } = resolveBinary();
  const fullArgs = [...binArgs, ...args];

  try {
    const { stdout, stderr } = await execFileAsync(cmd, fullArgs, {
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024, // 10MB
      encoding: "utf-8",
      windowsHide: true,
    });

    const trimmed = stdout.trim();
    if (!trimmed) {
      throw new WebcmdCliError(
        "EMPTY_OUTPUT",
        "webcmd returned empty output",
        `Command: webcmd ${args.join(" ")}\nStderr: ${stderr.slice(0, 500)}`
      );
    }

    try {
      return JSON.parse(trimmed);
    } catch {
      throw new WebcmdCliError(
        "PARSE_ERROR",
        "webcmd returned non-JSON output",
        `Output: ${trimmed.slice(0, 500)}`
      );
    }
  } catch (err: unknown) {
    if (err instanceof WebcmdCliError) throw err;

    const nodeErr = err as {
      code?: string;
      stdout?: string;
      stderr?: string;
      message?: string;
    };

    // Attempt to parse structured error from stdout/stderr
    const raw = nodeErr.stdout || nodeErr.stderr || "";
    const parsed = tryParseError(raw);

    if (parsed) {
      throw new WebcmdCliError(
        parsed.code || "CLI_ERROR",
        parsed.message || "webcmd command failed",
        parsed.hint
      );
    }

    if (nodeErr.code === "ETIMEDOUT") {
      throw new WebcmdCliError(
        "TIMEOUT",
        `webcmd command timed out after ${timeoutMs}ms`,
        `Command: webcmd ${args.join(" ")}`
      );
    }

    throw new WebcmdCliError(
      "CLI_ERROR",
      nodeErr.message || "webcmd command failed",
      `Exit code: ${nodeErr.code}\nStderr: ${(nodeErr.stderr || "").slice(0, 500)}`
    );
  }
}

function tryParseError(raw: string): {
  code?: string;
  message?: string;
  hint?: string;
} | null {
  // Try JSON error envelope: { error: { code, message, hint } }
  try {
    const obj = JSON.parse(raw);
    if (obj?.error?.code) return obj.error;
  } catch { /* not JSON */ }

  // Try YAML-like "error: ..." / "code: ..." lines
  const codeMatch = raw.match(/(?:error\.code|code):\s*(\S+)/i);
  const msgMatch = raw.match(/(?:error\.message|message):\s*(.+)/i);
  const hintMatch = raw.match(/hint:\s*(.+)/i);
  if (codeMatch || msgMatch) {
    return {
      code: codeMatch?.[1],
      message: msgMatch?.[1]?.trim(),
      hint: hintMatch?.[1]?.trim(),
    };
  }

  return null;
}

// ─── High-Level Commands ──────────────────────────────────────────────────────

/**
 * Run `webcmd doctor` to verify daemon is up and browser is installed.
 * Auto-starts the daemon if it's not running.
 *
 * The doctor report does NOT carry a top-level `ok`; health is derived from
 * `daemonRunning && runtimeConnected && binary.installed`.
 */
export async function ensureDaemon(): Promise<WebcmdDoctorReport> {
  const profile = cfg.webcmdProfile;
  const args = ["--profile", profile, "doctor", "-f", "json"];

  try {
    const result = (await webcmdExec(args, 60_000)) as WebcmdDoctorReport;
    const healthy =
      result.daemonRunning === true &&
      result.runtimeConnected === true &&
      result.binary?.installed !== false;
    return { ...result, ok: healthy };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof WebcmdCliError ? err.message : String(err),
    };
  }
}

/**
 * Create a session via `webcmd session create <name>`.
 * Returns the session ID and metadata.
 */
export async function createSession(
  name: string
): Promise<WebcmdSessionInfo> {
  const profile = cfg.webcmdProfile;
  const args = ["--profile", profile, "session", "create", name, "-f", "json"];
  const data = (await webcmdExec(args)) as WebcmdSessionInfo;

  if (!data?.id) {
    throw new WebcmdCliError(
      "SESSION_CREATE_FAILED",
      "webcmd session create returned no session ID",
      `Raw output: ${JSON.stringify(data).slice(0, 500)}`
    );
  }

  return data;
}

/**
 * Close a session via `webcmd session close <id>`.
 */
export async function closeSession(
  sessionId: string
): Promise<WebcmdCloseResult> {
  const profile = cfg.webcmdProfile;
  const args = ["--profile", profile, "session", "close", sessionId, "-f", "json"];

  try {
    return (await webcmdExec(args)) as WebcmdCloseResult;
  } catch {
    // Best-effort close — don't throw if session already closed
    return { closed: false, alreadyIdle: true, session: sessionId };
  }
}

/**
 * Run a browser program via `webcmd browser run --file <tmpfile>`.
 * The program source is written to a temp file and executed.
 */
export async function runBrowserProgram(
  sessionId: string,
  programSource: string,
  timeoutMs = 30_000,
  maxOutputChars?: number
): Promise<WebcmdRunResult> {
  const fs = await import("node:fs/promises");
  const os = await import("node:os");
  const path = await import("node:path");

  // Write program to a temp file
  const tmpDir = os.tmpdir();
  const tmpFile = path.join(tmpDir, `applyflow-run-${Date.now()}-${Math.random().toString(36).slice(2)}.js`);

  try {
    await fs.writeFile(tmpFile, programSource, "utf-8");

    const profile = cfg.webcmdProfile;
    const args = [
      "--profile", profile,
      "--session", sessionId,
      "browser", "run",
      "--file", tmpFile,
      ...(maxOutputChars !== undefined
        ? ["--max-output", String(Math.max(1024, maxOutputChars))]
        : []),
      "-f", "json",
    ];

    const result = (await webcmdExec(args, timeoutMs)) as WebcmdRunResult;

    if (result && typeof result === "object" && "error" in result) {
      const err = (result as { error: { code?: string; message?: string; hint?: string } }).error;
      throw new WebcmdCliError(
        err.code || "BROWSER_RUN_ERROR",
        err.message || "Browser program failed",
        err.hint
      );
    }

    return result;
  } finally {
    // Clean up temp file
    await fs.unlink(tmpFile).catch(() => {});
  }
}

/**
 * Take a snapshot of the current page.
 */
export async function takeSnapshot(
  sessionId: string,
  mode: "act" | "tree" | "read" = "act"
): Promise<unknown> {
  const profile = cfg.webcmdProfile;
  const args = [
    "--profile", profile,
    "--session", sessionId,
    "browser", "snapshot",
    "--snapshot-mode", mode,
    "-f", "json",
  ];

  return webcmdExec(args);
}

// ─── Error Class ──────────────────────────────────────────────────────────────

export class WebcmdCliError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly hint?: string
  ) {
    super(message);
    this.name = "WebcmdCliError";
  }
}
