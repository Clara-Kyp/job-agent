export type ApplyStatus = "queued" | "dispatched" | "worker_unconfigured" | "running" | "review" | "failed";

export interface ApplyJob {
  id: string;
  status: ApplyStatus;
  createdAt: string;
  message: string;
  progress?: unknown;
  result?: unknown;
}

const globalJobs = globalThis as typeof globalThis & { __jobAgentApplyJobs?: Map<string, ApplyJob> };
export const jobs = globalJobs.__jobAgentApplyJobs ??= new Map<string, ApplyJob>();
