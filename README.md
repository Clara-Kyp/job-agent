# Job Agent

[MIT 许可证：适用于本项目有权授权的代码](LICENSE)

Local-first job application preparation built from [ApplyFlow](https://github.com/SouravBhowmik-guice/ATS). Job Agent turns your resume and supplemental notes into a reusable candidate profile, asks for unsupported details, drafts grounded answers, fills ATS forms, and always stops before submission.

> Public beta: runs locally with Codex and Chrome. Never commit resumes, API keys, or `data/profile.json`.

### 国科微北森表单试点（本机）

网页入口支持粘贴 `https://goke.zhiye.com/form?jobAdId=...` 形式的具体申请表链接。先在“个人档案”中核对教育、工作和项目表格；已建档用户可通过“更新档案或材料 → 编辑已保存档案 → 从已保存简历补充空白表格”取得待核对建议。需要上传岗位匹配简历时，在运行区单独选择文件。点击“自动填写并停在提交前”后，Job Agent 使用本机独立 Chrome 会话；若出现登录页，申请人需自行登录。已确认的姓名、联系方式、教育、工作和项目字段会自动填写，无法匹配及未自动处理的必填字段会列在结果中，浏览器停在提交前。不会自动保存或投递。

这是单一站点的试点适配器。其他北森站点及不同招聘系统的字段、日期控件和附件入口还需要分别适配和验证；目前不承诺任意职位 URL 都能完整填写。

## Beta installation

```bash
git clone https://github.com/Clara-Kyp/job-agent.git
cd job-agent
npm ci
npm run build
npm run webcmd:setup
npm run webcmd:doctor
```

Copy `.env.example` to `.env`, add one supported LLM API key, then initialize the local profile as described below.

```
[ Resume + supplemental notes ]
        │
        ▼
 0. PROFILE ───► Extract verified facts and ask for missing details
        │
        ▼
[ Job URL + local profile ]
        │
        ▼
 1. EVALUATE ───► AI rates job fit (e.g., 8/10)
        │
        ▼
 2. EXPLORE ───► Agent crawls form DOM (semantic locators)
        │
        ▼
 3. DRAFT ─────► Generates custom EEO & cover letter answers
        │
        ▼
 4. PRE-FILL ──► Automates filling fields on live browser
        │
        ▼
 5. HUMAN-IN-THE-LOOP ──► Stops at "Submit" for human review
```

## ✨ Features

- **Persistent local profile** — stores verified facts, work authorization, preferences, reusable answers, and writing style in a gitignored JSON file.
- **No guessing** — missing, sensitive, and low-confidence fields are asked interactively or left blank.
- **AI Job-Fit Scoring** — Gemini evaluates how well your resume matches a job posting (1–10 scale), flagging gaps honestly.
- **Semantic Form Exploration** — Discovers form fields by their *labels* (not brittle CSS classes), so it survives ATS updates.
- **Custom Answer Drafting** — Generates tailored responses to "Why do you want to work here?" and other custom questions, grounded in your actual resume and the job's keywords.
- **Live Browser Automation via webcmd** — A visible Chrome window (managed by the [webcmd](https://github.com/agentrhq/webcmd) daemon) fills the form in real time. Every browser operation runs as a sandboxed QuickJS program — session-persistent, profile-based cookies, archive-able, and restartable.
- **Human-in-the-Loop Safe-Stop** — The agent pauses right above the **Submit** button. You own the submission. No fake data, no compliance risk.
- **SQLite Tracking** — Every application's URL, score, drafted answers, and status stored for later review.

## 🛠️ Tech Stack

| Layer | Choice |
|---|---|
| Language | TypeScript / Node.js |
| Browser engine | **[webcmd](https://github.com/agentrhq/webcmd)** (daemon + QuickJS sandbox, Playwright under the hood) |
| LLM | Gemini (`@google/generative-ai`) |
| Storage | better-sqlite3 |
| HTML parsing | Cheerio |

## 📦 Installation

```bash
npm install

# Build the vendored webcmd CLI (installs deps + compiles dist/):
npm run webcmd:setup

# Verify webcmd daemon + browser are ready:
npm run webcmd:doctor
```

That's it — no separate Playwright install. webcmd manages its own browser and daemon.

## 🔑 Setup

1. Copy `.env.example` to `.env`
2. Add your Gemini API key:

```bash
cp .env.example .env
# Edit .env — set GEMINI_API_KEY=your_key_here
```

3. (Optional) Replace `data/resumes/placeholder.txt` with your own resume.
4. (Optional) Point `WEBCMD_PATH` at another webcmd install, or change `WEBCMD_PROFILE`.

## 🚀 Usage

### Build your profile once

```bash
npm run profile:init -- ./data/resumes/your-resume.pdf ./optional-notes.txt
npm run profile:show
```

The profile is saved to `data/profile.json` with file mode `0600` and is excluded from Git. Press Enter during setup to leave an answer unknown. You can save a confirmed recurring answer later:

```bash
npm run profile:remember -- "Why are you interested in us?" "Your confirmed answer"
```

### Local web onboarding (public beta)

Run `npm run dev:web` and open `http://localhost:3000`. A first-time user now completes two steps:

1. Download the ZIP template, fill the included `个人信息表.xlsx` with basic details and resume sections, put one resume and optional supporting files into its named folders, then upload one ZIP. The personal form populates the web review fields automatically. The page routes files by folder and filename and previews extracted content from images, TXT, PDF, and Word files. Identity/visa files require explicit local-storage acknowledgement.
2. Review the extracted candidate fields and resume tables, correct document dates/scores/publication details, and save. Work, project, publication, and award rows offer optional AI polishing with a regeneration dialog; suggestions are applied only on explicit confirmation. Model provider, model name, and API key are configured in the local settings panel. The key is stored under gitignored `data/private/llm-settings.json` with owner-only permissions.

On later visits, the saved profile is detected and the user can paste a job URL without re-uploading the resume. A different resume can still be selected for one run. The intake API accepts only local `localhost` / `127.0.0.1` requests; it is not a multi-user hosted account service. A live application still needs the configured worker and stops before final submission.

The sample folder taxonomy behind this flow is documented in [the onboarding specification](docs/onboarding.md). Supporting documents are evidence for a future form, not auto-uploaded to employers or treated as verified profile facts merely because they were selected.

### Apply to a job

```bash
npm run apply -- https://boards.greenhouse.io/company/jobs/12345
# or with a custom resume:
npm run apply -- https://jobs.lever.co/company/abc123 ./my-resume.txt
```

The tool will:
1. Fetch and parse the job posting
2. Score your resume against it with Gemini
3. Start the webcmd daemon, create an `applyflow` profile, and open a Chrome session on the application form
4. Map every form field using semantic locators
5. Draft answers for custom questions
6. Pre-fill the form with your resume data + drafted answers (each fill runs as a QuickJS program)
7. **Stop before Submit** so you can review and click Submit yourself — the session stays open until you're done

### View history

```bash
npm run history
```

## 🧠 How the Browser Layer Works (webcmd integration)

Playwright is no longer driven directly from ApplyFlow's Node process. Instead:

1. **Daemon** — `webcmd doctor` bootstraps a local daemon (WebSocket) that owns browser contexts.
2. **Profile** — ApplyFlow uses a persistent `applyflow` profile (cookie jar + auth scope).
3. **Session** — Each apply run creates a readable session (e.g. `applyflow-2026-09-11-14-30`).
4. **Programs** — Every browser operation (navigate, analyze form, fill field, upload resume, scroll) is emitted as a JavaScript source string and executed inside webcmd's **QuickJS sandbox**, where only `page`, `context`, `browser`, and `console` are available. Programs return structured JSON.
5. **No `Page` leaks** — ApplyFlow never imports Playwright types. The `WebcmdSession` class is the single browser abstraction.

### Why this survives ATS updates

Traditional automation uses brittle selectors like `.field-class-v2`. ApplyFlow instead:

1. **Explores once** — a sandboxed program reads every input's *associated label* (`<label for="...">`, `<label>` wrapper, `aria-label`, placeholder) to understand what the field means.
2. **Maps semantically** — stores fields as `{ label: "GitHub URL", type: "url" }`, not as CSS classes.
3. **Fills robustly** — the fill program tries `getByLabel()` → `getByPlaceholder()` → `getByRole()` → CSS selector → label-wrapper, with per-type strategies for selects and radios.

Because Greenhouse and Lever use consistent, human-readable labels ("First Name", "Email", "LinkedIn URL"), this approach is dramatically more reliable on live demos.

## 🚨 Compliance Rules

- **Rule 1 — Live Demo**: Browser runs non-headless so judges watch fields fill in real time.
- **Rule 2 — Responsible Build**: The agent **never clicks Submit**. It scrolls to just above the button and stops, printing a Safe-Stop banner. The human retains full ownership of data transmission.

## 📁 Project Structure

```
src/
  index.ts                 # CLI orchestration (apply / history / help)
  config.ts                # .env config & ATS selector defaults
  types/index.ts           # Shared TypeScript types
  evaluator/
    job-scraper.ts         # Fetch + parse job posting (Greenhouse/Lever/generic)
    resume-parser.ts       # Parse plain-text resume into structured data
    scorer.ts              # Gemini job-fit scoring (1-10)
  explorer/
    form-analyzer.ts       # Run sandboxed DOM-crawl program → semantic field map
  drafter/
    answer-generator.ts    # Gemini drafts answers for custom questions
  filler/
    webcmd-cli.ts          # Thin subprocess wrapper around the webcmd binary
    webcmd-programs.ts     # QuickJS program builders (analyze/fill/upload/scroll)
    webcmd-session.ts      # Session lifecycle — replaces browser.ts
    form-filler.ts         # Fill fields via sandboxed programs, upload resume
  tracker/
    database.ts            # SQLite schema + CRUD
webcmd/                    # Vendored agentrhq/webcmd (built via npm run webcmd:setup)
data/
  resumes/placeholder.txt  # Sample resume (swap with your own)
  applyflow.db             # Created at runtime
```

## 🗺️ Roadmap

- [x] webcmd integration (agentrhq/webcmd — daemon-managed browser, QuickJS programs, session persistence, profile cookies)
- [ ] PDF resume parsing (PDF.js extraction pipeline)
- [ ] Workday multi-step form wizard support
- [ ] Interactive mode with inquirer prompts
- [ ] "Apply to N recent matching jobs" batch mode

## Web Application Architecture

Job Agent has a Next.js App Router frontend layered over the existing ApplyFlow automation engine. The browser worker stays outside Vercel because webcmd owns a visible Chrome session and can exceed serverless execution and binary limits.

```text
Browser -> Next.js dashboard on Vercel -> WORKER_URL -> dedicated Node worker
                                                     -> evaluator -> explorer -> drafter -> filler
                                                     -> safe-stop before Submit
```

### Frontend files

| File | Responsibility |
|---|---|
| `src/app/page.tsx` | Dashboard input flow, settings, staged execution view |
| `src/components/ResumeDropzone.tsx` | PDF-only drag-and-drop uploader |
| `src/components/ExecutionConsole.tsx` | Animated terminal-style progress log |
| `src/components/HumanVerificationModal.tsx` | Field preview and manual approval gate |
| `src/app/api/apply/route.ts` | Node runtime validation, PDF extraction, worker dispatch, SSE status stream |

### Local web development

```bash
npm run dev:web
```

Open `http://localhost:3000`. The dashboard can run its visual flow without a worker, but live browser automation requires the worker configuration below.

### Vercel and worker configuration

Deploy the Next.js app to Vercel and set:

```env
WORKER_URL=https://your-worker.example.com/apply
WORKER_SHARED_SECRET=replace-with-a-server-side-secret
PROGRESS_CALLBACK_URL=https://your-vercel-app.vercel.app/api/apply/status
PROGRESS_CALLBACK_SECRET=replace-with-the-same-secret
```

The worker accepts the JSON payload posted by `/api/apply`, writes the PDF to temporary storage, and invokes the shared runner in `src/worker/run-application.ts`. It publishes progress events to `PROGRESS_CALLBACK_URL`; the current callback store is suitable for local development, while production should replace it with Redis or a database for multi-instance durability.

`GEMINI_API_KEY` is accepted for a single run from the settings panel and is never persisted by the Next.js route. For production, prefer a server-side secret or authenticated secret vault. `MOCK_LLM` and `SLOW_MO` are passed to the worker as per-run settings.

The application never clicks Submit automatically. The worker stops at the existing `pauseBeforeSubmit` gateway, and the frontend presents a human verification screen before any final action.

## License

Job Agent is released under the [MIT license](LICENSE). It is based on [ApplyFlow](https://github.com/SouravBhowmik-guice/ATS) by Sourav Bhowmik. The upstream package declares MIT in `package.json` but does not include a separate license file; see [NOTICE.md](NOTICE.md) for attribution.
