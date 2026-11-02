import { NextRequest, NextResponse } from "next/server";
import { jobs } from "../store";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const expected = process.env.PROGRESS_CALLBACK_SECRET || process.env.WORKER_SHARED_SECRET;
  if (!expected || request.headers.get("authorization") !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json() as {
    jobId?: string;
    progress?: { stage?: string; message?: string };
    result?: unknown;
  };
  if (!body.jobId || !body.progress) return NextResponse.json({ error: "jobId and progress are required" }, { status: 400 });

  const job = jobs.get(body.jobId);
  if (!job) return NextResponse.json({ error: "Application run not found" }, { status: 404 });
  const stage = body.progress.stage;
  job.status = stage === "review" ? "review" : stage === "failed" ? "failed" : "running";
  job.message = body.progress.message || job.message;
  job.progress = body.progress;
  job.result = body.result;
  return NextResponse.json({ ok: true });
}