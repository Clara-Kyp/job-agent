---
name: applyflow-job-agent
description: Prepare a job application from a URL using the candidate's verified local profile and matching resume. Use when the user wants to inspect, tailor, or prefill a job application. Leave unsupported fields blank or ask the user, and always stop before final submission.
---

# Job Agent

Use the project two directories above this file as the execution engine.

## First use

If `data/profile.json` does not exist, ask for a PDF or TXT resume and any supplemental text notes, then run:

```bash
npm run profile:init -- <resume.pdf|resume.txt> [supplement.txt ...]
```

The setup command extracts durable facts and asks for common application data absent from the resume. The profile is local and gitignored. Never infer visa status, sponsorship, compensation, availability, demographic information, or other unsupported facts.

## Prepare an application

Accept one job URL and optionally a resume path. Prefer the resume saved in `data/profile.json`; use a different resume only when the user selects it for that job.

```bash
npm run apply -- <job-url> [resume-path]
```

During the run:

- Base answers only on the resume, profile facts, and confirmed reusable answers.
- Ask for missing required fields when interactive input is available.
- Leave unanswered, sensitive, or low-confidence fields blank.
- Upload and fill the selected resume, then keep the browser open for review.
- Never click, invoke, or simulate the final submit action. Final submission belongs to the user.

After the user confirms a reusable answer or writing preference, persist it with `profile:remember` or edit the local profile through the project command. Do not store generated drafts as confirmed facts.

## Useful commands

```bash
npm run profile:show
npm run profile:remember -- "<question>" "<confirmed answer>"
npm run history
```

For the profile schema and confidence behavior, read [references/profile.md](references/profile.md).
