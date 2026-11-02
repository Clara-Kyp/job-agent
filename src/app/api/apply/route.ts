import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { NextRequest, NextResponse } from "next/server";
import { jobs, type ApplyJob } from "./store";
import { loadProfile } from "../../../profile/profile-store";
import { loadLocalLLMSettings } from "../../../llm/local-settings";
import { checkLocalRequest } from "../../../intake/local-store";
import { readIntakeText } from "../../../intake/read-file";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_RESUME_BYTES = 10 * 1024 * 1024;
const supportedHosts = [
  "greenhouse.io",
  "lever.co",
  "workday.com",
  "myworkdayjobs.com",
  "icims.com",
  "taleo.net",
];

function validateJobUrl(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("Enter a valid job posting URL.");
  }
  if (url.hostname === "iter.stongyw.cn") throw new Error("已识别广东通服校园招聘职位，但该站申请表需要登录后适配。请先使用“检查这个职位”查看详情；目前尚不能自动填写。");

  if (
    url.protocol !== "https:" ||
    !(url.hostname === "goke.zhiye.com" && url.pathname === "/form" && /^[0-9a-f-]{36}$/i.test(url.searchParams.get("jobAdId") || "")) &&
    !supportedHosts.some(
      (host) => url.hostname === host || url.hostname.endsWith(`.${host}`),
    )
  ) {
    throw new Error(
      "Use a supported ATS job URL or a Guoke Beisen application form URL.",
    );
  }
  return url;
}

async function parseResume(
  bytes: Uint8Array,
  filename: string,
  contentType: string,
): Promise<string> {
  return readIntakeText(new File([Buffer.from(bytes)], filename, { type: contentType }), true);
}

export async function POST(request: NextRequest) {
  try {
    checkLocalRequest(request);
    const form = await request.formData();
    const localLLM = loadLocalLLMSettings();
    const rawUrl = String(form.get("jobUrl") || "");
    const resume = form.get("resume");
    const apiKey = String(form.get("geminiApiKey") || "").trim() || (localLLM?.provider === "gemini" ? localLLM.apiKey : "");
    const anthropicApiKey = String(form.get("anthropicApiKey") || "").trim() || (localLLM?.provider === "anthropic" ? localLLM.apiKey : "");
    const provider = String(
      localLLM?.provider || form.get("provider") || process.env.LLM_PROVIDER || "gemini",
    ).toLowerCase();
    const openaiApiKey = localLLM && ["deepseek", "openai"].includes(localLLM.provider) ? localLLM.apiKey : "";
    const runtimeProvider = provider === "deepseek" ? "openai" : provider;
    const mockLLM = String(form.get("mockLLM") || "true") === "true";
    const slowMo = Number(form.get("slowMo") || 100);

    const jobUrl = validateJobUrl(rawUrl).toString();
    let resumeName: string;
    let resumeType: string;
    let bytes: Uint8Array;
    if (resume instanceof File) {
      resumeName = resume.name;
      resumeType = resume.type;
      bytes = new Uint8Array(await resume.arrayBuffer());
    } else {
      const profile = loadProfile();
      if (!profile || !existsSync(profile.resumePath))
        throw new Error("Create a local candidate profile before starting.");
      resumeName = profile.resumePath.split("/").pop() || "resume.pdf";
      const extension = resumeName.toLowerCase().split(".").pop();
      resumeType = extension === "txt" ? "text/plain" : extension === "pdf" ? "application/pdf" : extension === "png" ? "image/png" : extension === "jpg" || extension === "jpeg" ? "image/jpeg" : extension === "docx" ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document" : "application/msword";
      bytes = new Uint8Array(readFileSync(profile.resumePath));
    }
    if (bytes.byteLength > MAX_RESUME_BYTES)
      throw new Error("Resume must be 10 MB or smaller.");
    const hasServerGeminiKey = Boolean(
      process.env.GEMINI_API_KEY &&
      process.env.GEMINI_API_KEY !== "your-gemini-key-here",
    );
    const hasServerAnthropicKey = Boolean(process.env.ANTHROPIC_API_KEY);
    const workerUrl = process.env.WORKER_URL;
    const workerHandlesLLM = Boolean(workerUrl);
    if (
      !mockLLM &&
      provider === "gemini" &&
      !apiKey &&
      !hasServerGeminiKey &&
      !workerHandlesLLM
    )
      throw new Error(
        "Add a Gemini API key or configure GEMINI_API_KEY on the server, or configure WORKER_URL.",
      );
    if (
      !mockLLM &&
      provider === "anthropic" &&
      !anthropicApiKey &&
      !hasServerAnthropicKey &&
      !workerHandlesLLM
    )
      throw new Error(
        "Add a Claude API key or configure ANTHROPIC_API_KEY on the server.",
      );
    if (!mockLLM && runtimeProvider === "openai" && !openaiApiKey && !process.env.OPENAI_API_KEY) throw new Error("请先在设置中保存模型 API Key。");
    if (!Number.isFinite(slowMo) || slowMo < 0 || slowMo > 5000)
      throw new Error("Slow-mo must be between 0 and 5000 milliseconds.");

    const resumeText = await parseResume(bytes, resumeName, resumeType);
    if (!resumeText)
      throw new Error("未能从简历中识别文字，请换一份清晰的图片、TXT、PDF 或 Word 文件。");

    const id = randomUUID();
    const job: ApplyJob = {
      id,
      status: "queued",
      createdAt: new Date().toISOString(),
      message: "Payload validated and queued.",
    };
    jobs.set(id, job);

    if (workerUrl) {
      const workerResponse = await fetch(workerUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(process.env.WORKER_SHARED_SECRET
            ? { authorization: `Bearer ${process.env.WORKER_SHARED_SECRET}` }
            : {}),
        },
        body: JSON.stringify({
          id,
          jobUrl,
          resume: {
            filename: resumeName,
            contentType: resumeType,
            base64: Buffer.from(bytes).toString("base64"),
            text: resumeText,
          },
          settings: {
            provider: runtimeProvider,
            openaiApiKey: openaiApiKey || undefined,
            openaiModel: localLLM && ["deepseek", "openai"].includes(localLLM.provider) ? localLLM.model : undefined,
            openaiBaseUrl: provider === "deepseek" ? "https://api.deepseek.com" : undefined,
            geminiModel: localLLM?.provider === "gemini" ? localLLM.model : undefined,
            anthropicModel: localLLM?.provider === "anthropic" ? localLLM.model : undefined,
            apiKey: apiKey || undefined,
            anthropicApiKey: anthropicApiKey || undefined,
            mockLLM,
            slowMo,
            uploadSelectedResume: resume instanceof File,
          },
        }),
      });
      if (!workerResponse.ok)
        throw new Error(`Worker rejected the job (${workerResponse.status}).`);
      job.status = "dispatched";
      job.message = "Worker accepted the application run.";
    } else {
      job.status = "worker_unconfigured";
      job.message =
        "No WORKER_URL is configured. Configure the browser worker before live runs.";
    }

    return NextResponse.json(
      {
        jobId: id,
        status: job.status,
        message: job.message,
        resumePreview: resumeText.slice(0, 280),
        streamUrl: `/api/apply?jobId=${id}`,
      },
      { status: 202 },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to start application run.",
      },
      { status: 400 },
    );
  }
}

export async function GET(request: NextRequest) {
  const jobId = request.nextUrl.searchParams.get("jobId");
  if (!jobId)
    return NextResponse.json({ error: "jobId is required." }, { status: 400 });
  if (!jobs.has(jobId))
    return NextResponse.json(
      { error: "Application run not found." },
      { status: 404 },
    );

  if (request.headers.get("accept") === "application/json") {
    return NextResponse.json(jobs.get(jobId));
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      let lastPayload = "";
      let heartbeat: ReturnType<typeof setInterval> | undefined;
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const close = () => {
        if (closed) return;
        closed = true;
        if (heartbeat) clearInterval(heartbeat);
        if (timeout) clearTimeout(timeout);
        try {
          controller.close();
        } catch {
          // The client may have closed the stream first.
        }
      };
      const send = () => {
        const job = jobs.get(jobId);
        if (!job) return;
        const payload = JSON.stringify(job);
        if (closed || payload === lastPayload) return;
        lastPayload = payload;
        try {
          controller.enqueue(
            encoder.encode(`event: status\ndata: ${payload}\n\n`),
          );
        } catch {
          close();
        }
      };
      send();
      heartbeat = setInterval(() => {
        send();
        if (jobs.get(jobId)?.status === "failed") {
          close();
        }
      }, 1000);
      timeout = setTimeout(() => {
        close();
      }, 25_000);
    },
  });

  return new NextResponse(stream, {
    headers: {
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "content-type": "text/event-stream",
    },
  });
}
