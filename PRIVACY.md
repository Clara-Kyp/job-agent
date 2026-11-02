# Privacy for beta testers

Job Agent runs the application workflow on the tester's computer. Resume files, `data/profile.json`, `data/private/`, `.env*` (except `.env.example`), generated output, and the local application database are excluded by `.gitignore`. This does not remove files that were already committed; check the repository history before publishing.

The local model settings file in `data/private/llm-settings.json` may contain an API key. The browser profile in `data/private/browser-profile/` may contain cookies and login sessions. Keep both directories private and do not include them in release archives.

Job descriptions and the minimum candidate context needed to draft or score an application are sent to the LLM provider selected by the tester. Browser automation visits the job application URL supplied by the tester and fills the remote form, but the agent does not submit it.

Testers should review their selected LLM provider's data policy before using live mode. They can use `MOCK_LLM=true` for a local demonstration without sending candidate context to an LLM provider.
