---
name: setup-applyflow-job-agent
description: Set up the Job Agent public beta on a user's computer, including dependencies, local configuration, browser checks, and initial candidate profile creation.
---

# Set up ApplyFlow Job Agent

Run setup from the plugin root. Confirm Node.js 20 or later is available, then install and build the project:

```bash
npm ci
npm run build
npm run webcmd:setup
npm run webcmd:doctor
```

Copy `.env.example` to `.env` if it does not exist. Ask the user which supported LLM provider they want and have them add the corresponding API key locally. Never read, print, transmit, or commit the key.

Ask for a PDF or TXT resume and optional supplemental TXT notes, then run:

```bash
npm run profile:init -- <resume.pdf|resume.txt> [supplement.txt ...]
```

Confirm that `data/profile.json` exists and remains ignored by Git. Do not upload the resume, profile, application database, or `.env` file.
