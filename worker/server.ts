import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { runApplication, type ApplicationProgress } from "../src/worker/run-application.js";
import { runBeisenProfile } from "../src/beisen/run-profile.js";
import { ensureDirectories } from "../src/config.js";

const port = Number(process.env.PORT || 8080);
const sharedSecret = process.env.WORKER_SHARED_SECRET || "";
const callbackUrl = process.env.PROGRESS_CALLBACK_URL || "";
const workerCallbackSecret = process.env.PROGRESS_CALLBACK_SECRET || sharedSecret;

interface ApplyRequest {
  id?: string;
  jobUrl?: string;
  resume?: { filename?: string; base64?: string };
  settings?: { mockLLM?: boolean; slowMo?: number; apiKey?: string; provider?: string; anthropicApiKey?: string; openaiApiKey?: string; openaiModel?: string; openaiBaseUrl?: string; geminiModel?: string; anthropicModel?: string; uploadSelectedResume?: boolean };
}

async function readJson(request: import("node:http").IncomingMessage): Promise<ApplyRequest> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as ApplyRequest;
}

function authorized(request: import("node:http").IncomingMessage): boolean {
  return Boolean(sharedSecret) && request.headers.authorization === `Bearer ${sharedSecret}`;
}

async function postProgress(jobId: string, progress: ApplicationProgress, result?: unknown): Promise<void> {
  if (!callbackUrl) return;
  const response = await fetch(callbackUrl, {
    method: "POST",
    signal: AbortSignal.timeout(5000),
    headers: {
      "content-type": "application/json",
      ...(workerCallbackSecret ? { authorization: `Bearer ${workerCallbackSecret}` } : {}),
    },
    body: JSON.stringify({ jobId, progress, result }),
  }).catch((error) => { console.error("Progress callback failed:", error); return null; });
  if (response && !response.ok) console.error(`Progress callback rejected job ${jobId}: HTTP ${response.status}`);
}

async function runJob(payload: ApplyRequest): Promise<void> {
  const jobId = payload.id || randomUUID();
  if (!payload.resume?.base64 || !payload.jobUrl) return;

  const directory = join(process.cwd(), ".worker-resumes");
  const extension = extname(payload.resume.filename || "").toLowerCase();
  const allowedExtensions = new Set([".pdf", ".docx", ".doc", ".txt", ".png", ".jpg", ".jpeg"]);
  if (!allowedExtensions.has(extension)) throw new Error("Unsupported resume format.");
  const resumePath = join(directory, `${jobId}${extension}`);
  await mkdir(directory, { recursive: true });
  await writeFile(resumePath, Buffer.from(payload.resume.base64, "base64"));

  try {
    const target = new URL(payload.jobUrl);
    if (target.hostname === "goke.zhiye.com" && target.pathname === "/form") {
      const result = await runBeisenProfile({
        url: payload.jobUrl,
        resumePath,
        uploadSelectedResume: payload.settings?.uploadSelectedResume === true,
        onProgress: (stage, message) => postProgress(jobId, { stage: stage as ApplicationProgress["stage"], message }),
      });
      await postProgress(jobId, { stage: "review", message: `已填写 ${result.filled} 项，浏览器停在提交前。` }, result);
      return;
    }
    const result = await runApplication({
      jobUrl: payload.jobUrl,
      resumePath,
      slowMo: payload.settings?.slowMo,
      mockLLM: payload.settings?.mockLLM,
      geminiApiKey: payload.settings?.apiKey,
      anthropicApiKey: payload.settings?.anthropicApiKey,
      llmProvider: payload.settings?.provider,
      openaiApiKey: payload.settings?.openaiApiKey,
      openaiModel: payload.settings?.openaiModel,
      openaiBaseUrl: payload.settings?.openaiBaseUrl,
      geminiModel: payload.settings?.geminiModel,
      anthropicModel: payload.settings?.anthropicModel,
      onProgress: (progress) => postProgress(jobId, progress),
    });
    await postProgress(jobId, { stage: "review", message: "Application is ready for human review." }, result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await postProgress(jobId, { stage: "failed", message, error: message });
  } finally {
    await rm(resumePath, { force: true });
  }
}

ensureDirectories();
const server = createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/health") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true }));
    return;
  }

  if (request.method === "POST" && request.url === "/apply") {
    if (!authorized(request)) {
      response.writeHead(401, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "Unauthorized" }));
      return;
    }

    try {
      const payload = await readJson(request);
      if (!payload.id || !payload.jobUrl || !payload.resume?.base64) throw new Error("id, jobUrl, and resume.base64 are required");
      response.writeHead(202, { "content-type": "application/json" });
      response.end(JSON.stringify({ accepted: true, jobId: payload.id }));
      void runJob(payload);
    } catch (error) {
      response.writeHead(400, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: error instanceof Error ? error.message : "Invalid request" }));
    }
    return;
  }

  response.writeHead(404, { "content-type": "application/json" });
  response.end(JSON.stringify({ error: "Not found" }));
});

server.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EADDRINUSE") {
    console.error(`ATS-Buster worker cannot start: port ${port} is already in use.`);
    console.error(`The existing worker may already be running. Check http://localhost:${port}/health or choose another PORT.`);
    process.exitCode = 1;
    return;
  }
  throw error;
});

server.listen(port, () => console.log(`ATS-Buster worker listening on :${port}`));
