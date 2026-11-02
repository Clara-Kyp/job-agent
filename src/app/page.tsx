"use client";

import { motion } from "framer-motion";
import {
  ArrowUpRight,
  BriefcaseBusiness,
  ChevronRight,
  KeyRound,
  Play,
  Settings2,
  Sparkles,
  UploadCloud,
} from "lucide-react";
import { useEffect, useState, type ComponentProps } from "react";
import {
  ExecutionConsole,
  type ExecutionLog,
} from "../components/ExecutionConsole";
import { HumanVerificationModal } from "../components/HumanVerificationModal";
import { ResumeDropzone } from "../components/ResumeDropzone";
import { ProfileOnboarding } from "../components/ProfileOnboarding";
import type { ResumeTable } from "../intake/structured-profile";

const baseLogs: ExecutionLog[] = [];
const time = () =>
  new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
type ReviewData = {
  jobUrl: string;
  company: string;
  title: string;
  evaluation: {
    score: number;
    recommendation: string;
    fitAnalysis: string;
    matchStrengths: string[];
    matchGaps: string[];
  };
  values: Array<{ label: string; value: string }>;
  answers: Array<{ label: string; answer: string }>;
};
type JobPreview = {
  url: string;
  title: string;
  company: string;
  details: string[];
  description: string;
  requirements: string;
  notice: string;
};

export default function Home() {
  const [jobUrl, setJobUrl] = useState("");
  const isSmicBeisenJob = jobUrl.includes("smics.zhiye.com/campusxq");
  const isStongywJob = jobUrl.includes("iter.stongyw.cn/web/school/job/position_details.html");
  const isGuokeBeisenJob = jobUrl.includes("goke.zhiye.com/form");
  const [jobPreview, setJobPreview] = useState<JobPreview | null>(null);
  const [previewMessage, setPreviewMessage] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [logs, setLogs] = useState(baseLogs);
  const [running, setRunning] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showReview, setShowReview] = useState(false);
  const [reviewData, setReviewData] = useState<ReviewData | null>(null);
  const [beisenReview, setBeisenReview] = useState<{ filled: number; unresolved: string[]; resumeUpload: string; results: Array<{ label: string; status: string }> } | null>(null);
  const [provider, setProvider] = useState("deepseek");
  const [llmModel, setLlmModel] = useState("deepseek-flash");
  const [llmKey, setLlmKey] = useState("");
  const [llmConfigured, setLlmConfigured] = useState(false);
  const [llmHint, setLlmHint] = useState("");
  const [llmStatus, setLlmStatus] = useState("");
  const [mockLLM, setMockLLM] = useState(false);
  const [slowMo, setSlowMo] = useState(100);
  const [profileReady, setProfileReady] = useState(false);
  const [profileName, setProfileName] = useState("");
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [onboardingMode, setOnboardingMode] = useState<"edit" | "upload">("edit");
  const [savedConfirmed, setSavedConfirmed] = useState<ComponentProps<typeof ProfileOnboarding>["initialConfirmed"]>(null);
  const [savedResumeTable, setSavedResumeTable] = useState<ResumeTable>({});
  const missingGuokeSections = ([
    ["教育经历", savedResumeTable.education],
    ["工作经历", savedResumeTable.employment],
    ["项目经历", savedResumeTable.projects],
  ] as const).filter(([, rows]) => !rows?.some((row) => row.some(Boolean))).map(([label]) => label);

  useEffect(() => {
    fetch("/api/settings/llm").then((response) => response.json()).then((result) => { setProvider(result.provider || "deepseek"); setLlmModel(result.model || "deepseek-flash"); setLlmConfigured(Boolean(result.configured)); setLlmHint(result.keyHint || ""); }).catch(() => {});
    fetch("/api/profile")
      .then((response) => response.json())
      .then((result) => { if (result.ready) { setProfileReady(true); setProfileName(result.candidateName || ""); setSavedConfirmed(result.confirmed || null); setSavedResumeTable(result.resumeTable || {}); } })
      .catch(() => {});
  }, []);

  async function startRun() {
    if (!jobUrl || (!file && !profileReady) || running) return;
    setRunning(true);
    setLogs([]);
    setBeisenReview(null);
    const payload = new FormData();
    payload.set("jobUrl", jobUrl);
    if (file) payload.set("resume", file);
    payload.set("provider", provider);
    payload.set("mockLLM", String(mockLLM));
    payload.set("slowMo", String(slowMo));
    let response: Response;
    try {
      response = await fetch("/api/apply", {
        method: "POST",
        body: payload,
      });
    } catch {
      setLogs([{ id: "network-error", text: "无法连接本机服务，请确认 Job Agent 正在运行。", stage: "error", time: time() }]);
      setRunning(false);
      return;
    }
    if (!response.ok) {
      const result = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      setLogs([
        {
          id: "error",
          text: result.error || "Unable to start application run.",
          stage: "error",
          time: time(),
        },
      ]);
      setRunning(false);
      return;
    }
    const result = (await response.json()) as { streamUrl: string; status?: string; message?: string };
    if (result.status === "worker_unconfigured") {
      setLogs([{ id: "worker-error", text: "申请执行器尚未配置：请设置 WORKER_URL 后再运行。", stage: "error", time: time() }]);
      setRunning(false);
      return;
    }
    const events = new EventSource(result.streamUrl);
    let finished = false;
    let polling = false;
    const poll = window.setInterval(async () => {
      if (finished || polling) return;
      polling = true;
      try {
        const response = await fetch(result.streamUrl, { headers: { accept: "application/json" } });
        if (response.status === 404) {
          finished = true;
          window.clearInterval(poll);
          events.close();
          setRunning(false);
          setLogs((current) => [...current, { id: crypto.randomUUID(), text: "任务状态已丢失，请刷新页面后重新运行。", stage: "error", time: time() }]);
          return;
        }
        if (response.ok) {
          const update = await response.json();
          if (update.status === "review" || update.status === "failed") {
            events.dispatchEvent(new MessageEvent("status", { data: JSON.stringify(update) }));
          }
        }
      } catch { /* Keep the live run open while the local service reconnects. */ }
      finally { polling = false; }
    }, 3000);
    events.addEventListener("status", (event) => {
      const update = JSON.parse(event.data) as {
        status: string;
        message: string;
        progress?: { stage?: string };
        result?: {
          job?: { url?: string; company?: string; title?: string };
          evaluation?: {
            score: number;
            recommendation: string;
            fitAnalysis: string;
            matchStrengths: string[];
            matchGaps: string[];
          };
          resume?: { email?: string; github?: string; linkedin?: string };
          draftedAnswers?: Array<{ fieldLabel: string; answer: string }>;
          beisen?: { results: Array<{ label: string; status: string }>; unresolved: string[]; resumeUpload: string };
          filled?: number;
        };
      };
      const stage =
        update.progress?.stage === "failed"
          ? "error"
          : update.progress?.stage === "review"
            ? "complete"
            : "running";
      setLogs((current) => [
        ...current,
        { id: crypto.randomUUID(), text: update.message, stage, time: time() },
      ]);
      if (update.progress?.stage === "review" && update.result) {
        finished = true; window.clearInterval(poll);
        if (update.result.beisen) {
          setBeisenReview({ ...update.result.beisen, filled: update.result.filled || 0 });
          setRunning(false);
          events.close();
          return;
        }
        setReviewData({
          jobUrl: update.result.job?.url || jobUrl,
          company: update.result.job?.company || "Detected company",
          title: update.result.job?.title || "Internship application",
          evaluation: update.result.evaluation || {
            score: 0,
            recommendation: "unknown",
            fitAnalysis: "No evaluation returned.",
            matchStrengths: [],
            matchGaps: [],
          },
          values: [
            {
              label: "Email",
              value: update.result.resume?.email || "Not found",
            },
            {
              label: "GitHub",
              value: update.result.resume?.github || "Not found",
            },
            {
              label: "LinkedIn",
              value: update.result.resume?.linkedin || "Not found",
            },
            { label: "Resume", value: file?.name || "Saved profile resume" },
          ],
          answers: (update.result.draftedAnswers || []).map((answer) => ({
            label: answer.fieldLabel,
            answer: answer.answer,
          })),
        });
        setRunning(false);
        setShowReview(true);
        events.close();
      }
      if (update.progress?.stage === "failed") {
        finished = true; window.clearInterval(poll);
        setRunning(false);
        events.close();
      }
    });
  }

  async function previewJob() {
    setJobPreview(null);
    setPreviewMessage("正在读取职位…");
    try {
      const response = await fetch(`/api/job-preview?url=${encodeURIComponent(jobUrl)}`);
      const result = await response.json() as JobPreview & { error?: string };
      if (!response.ok) throw new Error(result.error || "无法预览该职位。");
      setJobPreview(result);
      setPreviewMessage("");
    } catch (error) {
      setPreviewMessage(error instanceof Error ? error.message : "无法预览该职位。");
    }
  }

  return (
    <main className="min-h-screen">
      <header className="mx-auto flex max-w-7xl items-center justify-between px-5 py-6 sm:px-8">
        <div className="flex items-center gap-3">
          <div className="grid size-9 place-items-center rounded-xl bg-[#17211d] text-[#b8f2d0]">
            <Sparkles size={18} />
          </div>
          <span className="text-sm font-extrabold tracking-[-0.03em]">
            Job<span className="text-[#3baa70]"> Agent</span>
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden text-xs font-semibold text-[#7c8980] sm:inline">
            Human-led automation
          </span>
          <button
            onClick={() => setShowSettings((value) => !value)}
            className="inline-flex items-center gap-2 rounded-xl border border-[#dbe4db] bg-white/70 px-3 py-2 text-xs font-bold hover:bg-white"
          >
            <Settings2 size={15} /> Settings
          </button>
        </div>
      </header>
      <section className="mx-auto max-w-7xl px-5 pb-16 pt-10 sm:px-8 sm:pt-16">
        <div className="max-w-3xl">
          <motion.p
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-5 flex items-center gap-2 text-xs font-extrabold uppercase tracking-[0.18em] text-[#43976b]"
          >
            <span className="size-2 rounded-full bg-[#47c883]" /> Internship
            applications, minus the busywork
          </motion.p>
          <motion.h1
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 }}
            className="text-5xl font-extrabold leading-[.98] tracking-[-0.075em] text-[#17211d] sm:text-7xl"
          >
            Make the first move.
            <br />
            <span className="text-[#4aa974]">Keep the final word.</span>
          </motion.h1>
          <p className="mt-6 max-w-xl text-base leading-7 text-[#6a776f]">
            首次上传简历与相关证明，核对并保存个人档案。之后粘贴职位链接，
            Job Agent 会准备申请表，停在最终提交之前供你检查。
          </p>
        </div>
        <div className="mt-8">
          {profileReady && !showOnboarding ? <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#b8e9c9] bg-[#eaf8ee] px-5 py-4">
            <p className="text-sm font-bold text-[#2f6b4b]">已建立本机档案{profileName ? `：${profileName}` : ""}。现在可以直接粘贴职位链接。</p>
            <div className="flex items-center gap-4"><button onClick={() => { setOnboardingMode("edit"); setShowOnboarding(true); }} className="text-xs font-bold text-[#246f4b] underline">编辑个人档案</button><button onClick={() => { setOnboardingMode("upload"); setShowOnboarding(true); }} className="text-xs font-bold text-[#246f4b] underline">重新上传资料包</button></div>
          </div> : <ProfileOnboarding key={profileReady ? onboardingMode : "new"} existing={profileReady} initialMode={onboardingMode} initialConfirmed={savedConfirmed} initialResumeTable={savedResumeTable} onCancel={() => setShowOnboarding(false)} onSaved={(name) => { setProfileReady(true); setProfileName(name); setShowOnboarding(false); setFile(null); void fetch("/api/profile").then((response) => response.json()).then((result) => { setSavedConfirmed(result.confirmed || null); setSavedResumeTable(result.resumeTable || {}); }).catch(() => {}); }} />}
        </div>
        <div className="mt-8 grid gap-6 lg:grid-cols-[1.05fr_.95fr]">
          <motion.section
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.12 }}
            className="rounded-3xl border border-[#dce5dc] bg-[#fbfcf8]/90 p-5 shadow-[0_18px_60px_rgba(67,93,73,0.08)] sm:p-7"
          >
            <div className="mb-6 flex items-center justify-between">
              <div>
                <p className="text-xs font-extrabold uppercase tracking-[0.14em] text-[#849087]">
                  Step 2 · 职位链接
                </p>
                <h2 className="mt-1 text-xl font-extrabold tracking-[-0.04em]">
                  粘贴想申请的岗位 URL
                </h2>
              </div>
              <BriefcaseBusiness className="text-[#5aa979]" size={22} />
            </div>
            <label
              className="mb-2 block text-xs font-bold text-[#546259]"
              htmlFor="job-url"
            >
              Job posting URL
            </label>
            <div className="relative">
              <input
                id="job-url"
                value={jobUrl}
                onChange={(event) => { setJobUrl(event.target.value); setJobPreview(null); setPreviewMessage(""); }}
                placeholder="https://boards.greenhouse.io/company/jobs/12345"
                className="w-full rounded-xl border border-[#dce5dc] bg-white px-4 py-3.5 pr-11 text-sm outline-none transition placeholder:text-[#a0aaa2] focus:border-[#66bd8a] focus:ring-4 focus:ring-[#ccefd9]"
              />
              <ArrowUpRight
                className="absolute right-4 top-4 text-[#96a39a]"
                size={17}
              />
            </div>
            {(isSmicBeisenJob || isStongywJob) && (
              <div className="mt-3 space-y-3">
                <button type="button" onClick={previewJob} className="rounded-xl border border-[#b7d8bf] px-4 py-2 text-sm font-bold text-[#246b43]">检查这个职位</button>
                {previewMessage && <p className="text-sm text-[#725536]">{previewMessage}</p>}
                {jobPreview && <div className="rounded-xl border border-[#cfe0d1] bg-[#f5faf5] p-4 text-sm text-[#33473a]">
                  <p className="font-extrabold">{jobPreview.company} · {jobPreview.title}</p>
                  <p className="mt-1">{jobPreview.details.join(" · ")}</p>
                  <p className="mt-2"><b>职位要求：</b>{jobPreview.requirements}</p>
                  <p className="mt-2 text-[#895b25]">{jobPreview.notice}</p>
                  <a href={jobPreview.url} target="_blank" rel="noopener noreferrer" className="mt-3 inline-block font-bold text-[#246b43] underline">在招聘网站打开并登录</a>
                </div>}
              </div>
            )}
            {isGuokeBeisenJob && <p className="mt-3 rounded-xl bg-[#eaf8ee] p-3 text-xs leading-5 text-[#356c4b]">国科微北森试点：点击下方按钮后，Job Agent 会打开独立 Chrome。若需登录，请在该窗口自行完成；随后自动填写档案字段并停在提交前。需上传匹配简历时，请在下方单独选择该版本。</p>}
            {jobUrl && profileReady && !isSmicBeisenJob && !isStongywJob && <p className="mt-3 rounded-xl bg-[#fff3df] p-3 text-xs leading-5 text-[#825b26]">可用虚构档案测试表单填写；请勿在真实招聘网站暂存或投递测试资料。Job Agent 会停在最终提交前。</p>}
            {isGuokeBeisenJob && profileReady && missingGuokeSections.length > 0 && <p className="mt-3 rounded-xl bg-[#fff3df] p-3 text-xs leading-5 text-[#825b26]">已保存档案缺少{missingGuokeSections.join("、")}表格。当前运行只会填写有依据的字段；请先在上方更新档案并核对这些经历，才能完整自动填写。</p>}
            <div className="my-6 flex items-center gap-3 text-[10px] font-bold uppercase tracking-[0.14em] text-[#98a49b]">
              <span className="h-px flex-1 bg-[#e2e9e2]" />
              Candidate profile
              <span className="h-px flex-1 bg-[#e2e9e2]" />
            </div>
            {profileReady ? <p className="rounded-xl bg-[#eaf8ee] px-4 py-3 text-xs font-semibold text-[#3b7353]">默认使用已保存的简历。若这份岗位需要另一版本，可在下面临时替换。</p> : <p className="rounded-xl bg-[#fff3df] px-4 py-3 text-xs font-semibold text-[#8b6c36]">先完成上方的首次建档，再输入职位 URL。</p>}
            {profileReady && <div className="mt-4"><ResumeDropzone file={file} onFileChange={setFile} /></div>}
            <button
              disabled={!jobUrl || !profileReady || running || isSmicBeisenJob || isStongywJob}
              onClick={startRun}
              className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-[#17211d] px-4 py-3.5 text-sm font-extrabold text-white transition hover:-translate-y-0.5 hover:bg-[#2a4034] disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Play size={16} fill="currentColor" />
              {running ? "Agent is working..." : isSmicBeisenJob || isStongywJob ? "此平台表单接入中" : isGuokeBeisenJob ? "自动填写并停在提交前" : "Prepare application"}
              <ChevronRight size={16} />
            </button>
          </motion.section>
          <motion.section
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
          >
            <div className="mb-4 flex items-end justify-between">
              <div>
                <p className="text-xs font-extrabold uppercase tracking-[0.14em] text-[#849087]">
                  Execution monitor
                </p>
                <h2 className="mt-1 text-xl font-extrabold tracking-[-0.04em]">
                  A transparent run
                </h2>
              </div>
              <span className="font-mono text-[10px] text-[#8a978e]">
                4 stages
              </span>
            </div>
            <ExecutionConsole logs={logs} />
            {beisenReview && <div className="mt-4 rounded-2xl border border-[#b8e9c9] bg-[#f2fbf4] p-4 text-xs leading-6 text-[#315c41]">
              <p className="text-sm font-bold">国科微表单已填写 {beisenReview.filled} 项，请在打开的 Chrome 窗口核对</p>
              <p>简历：{beisenReview.resumeUpload}</p>
              <p>未处理／需核对：{beisenReview.unresolved.length} 项。未点击暂存或提交。</p>
              {beisenReview.unresolved.length > 0 && <ul className="mt-2 list-inside list-disc">{beisenReview.unresolved.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul>}
            </div>}
            <div className="mt-4 grid grid-cols-4 gap-2">
              {["Detect", "Extract", "Populate", "Review"].map(
                (label, index) => (
                  <div
                    key={label}
                    className={`rounded-xl border p-3 ${logs.some((log) => log.id === `${index}-run` && log.stage === "complete") ? "border-[#b8e9c9] bg-[#eaf8ee]" : "border-[#dce5dc] bg-white/50"}`}
                  >
                    <span className="font-mono text-[10px] text-[#94a198]">
                      0{index + 1}
                    </span>
                    <p className="mt-2 text-[11px] font-bold text-[#536158]">
                      {label}
                    </p>
                  </div>
                ),
              )}
            </div>
          </motion.section>
        </div>
      </section>
      {showSettings && (
        <div className="fixed right-5 top-20 z-40 w-80 rounded-2xl border border-[#dce5dc] bg-[#fbfcf8] p-5 shadow-2xl sm:right-8">
          <div className="flex items-center gap-2">
            <KeyRound size={17} className="text-[#419467]" />
            <p className="font-extrabold">Execution settings</p>
          </div>
          <label className="mt-5 block text-xs font-bold text-[#65736a]">模型服务商<select value={provider} onChange={(event) => { const next = event.target.value; setProvider(next); setLlmModel(({ deepseek: "deepseek-flash", openai: "gpt-4o-mini", gemini: "gemini-1.5-flash", anthropic: "claude-3-5-sonnet-latest" } as Record<string, string>)[next]); }} className="mt-2 w-full rounded-lg border bg-white px-3 py-2 text-sm"><option value="deepseek">DeepSeek</option><option value="openai">OpenAI</option><option value="gemini">Gemini</option><option value="anthropic">Anthropic</option></select></label>
          <label className="mt-3 block text-xs font-bold text-[#65736a]">模型名称<input value={llmModel} onChange={(event) => setLlmModel(event.target.value)} className="mt-2 w-full rounded-lg border bg-white px-3 py-2 text-sm" /></label>
          <label className="mt-3 block text-xs font-bold text-[#65736a]">API Key<input type="password" value={llmKey} onChange={(event) => setLlmKey(event.target.value)} placeholder={llmConfigured ? `已保存 ${llmHint}；留空保持不变` : "输入 API Key"} className="mt-2 w-full rounded-lg border bg-white px-3 py-2 text-sm" /></label>
          <button type="button" onClick={async () => { setLlmStatus("保存中…"); try { const response = await fetch("/api/settings/llm", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider, model: llmModel, apiKey: llmKey }) }); const result = await response.json(); if (!response.ok) throw new Error(result.error || "保存失败"); setLlmKey(""); setLlmConfigured(true); setLlmHint(result.keyHint); setLlmStatus("已保存到本机"); } catch (error) { setLlmStatus(error instanceof Error ? error.message : "保存失败"); } }} className="mt-3 w-full rounded-lg bg-[#17211d] px-3 py-2 text-xs font-bold text-white">保存 API 配置</button>
          {llmStatus && <p role="status" className="mt-2 text-xs text-[#246f4b]">{llmStatus}</p>}
          <label className="mt-4 flex items-center justify-between text-xs font-bold text-[#65736a]">
            Mock LLM
            <span className="relative">
              <input
                type="checkbox"
                checked={mockLLM}
                onChange={(event) => setMockLLM(event.target.checked)}
                className="peer sr-only"
              />
              <span className="block h-6 w-11 rounded-full bg-[#cdd8cf] peer-checked:bg-[#55bd82] after:absolute after:left-1 after:top-1 after:size-4 after:rounded-full after:bg-white after:transition peer-checked:after:translate-x-5" />
            </span>
          </label>
          <label className="mt-4 block text-xs font-bold text-[#65736a]">
            Slow-mo delay: {slowMo}ms
            <input
              type="range"
              min="0"
              max="1000"
              step="50"
              value={slowMo}
              onChange={(event) => setSlowMo(Number(event.target.value))}
              className="mt-3 w-full accent-[#3eaa70]"
            />
          </label>
          <p className="mt-4 text-[11px] leading-5 text-[#8a968e]">
            {mockLLM
              ? "Mock mode is on for a safe local demo."
              : "Live LLM mode will send the key to your configured worker."}
          </p>
        </div>
      )}
      <HumanVerificationModal
        data={showReview ? reviewData : null}
        onClose={() => setShowReview(false)}
        onContinue={() => setShowReview(false)}
      />
    </main>
  );
}
