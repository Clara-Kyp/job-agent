import { config } from "dotenv";
import { resolve } from "path";
import { existsSync, mkdirSync } from "fs";

config();

function optional(key: string, fallback: string): string {
  return process.env[key] || fallback;
}

/**
 * Ensure required data directories exist.
 * Called once at startup from main().
 */
export function ensureDirectories(): void {
  const dataDir = resolve(process.cwd(), "data");
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });

  const resumesDir = resolve(dataDir, "resumes");
  if (!existsSync(resumesDir)) mkdirSync(resumesDir, { recursive: true });
}

export const cfg = {
  // LLM provider selection. Defaults to Gemini; OpenAI / Anthropic are opt-in
  // backends selectable via LLM_PROVIDER (their SDKs load lazily).
  llmProvider: (process.env.LLM_PROVIDER || "gemini").toLowerCase(),
  // Gemini key is optional in MOCK_LLM mode (browser pipeline can run without it).
  geminiApiKey: process.env.GEMINI_API_KEY || "",
  openaiApiKey: process.env.OPENAI_API_KEY || "",
  openaiModel: optional("OPENAI_MODEL", "gpt-4o"),
  openaiBaseUrl: process.env.OPENAI_BASE_URL || "",
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || "",
  anthropicModel: optional("ANTHROPIC_MODEL", "claude-sonnet-5"),
  mockLLM: process.env.MOCK_LLM === "true",
  resumePath: resolve(optional("RESUME_PATH", "./data/resumes/placeholder.txt")),
  headless: process.env.HEADLESS === "true",
  slowMo: parseInt(process.env.SLOW_MO || "100", 10),
  dbPath: resolve(optional("DB_PATH", "./data/applyflow.db")),

  // webcmd browser layer
  // Empty string → auto-resolve (project-local webcmd/ or globally installed `webcmd`).
  webcmdBinary: optional("WEBCMD_PATH", ""),
  webcmdProfile: optional("WEBCMD_PROFILE", "applyflow"),

  // LLM settings
  geminiModel: process.env.GEMINI_MODEL || "gemini-3.6-flash",
  geminiTemp: 0.7,

  // ATS selectors (semantic-based)
  greenhouse: {
    formSelector: ".application-form",
    submitSelector: 'button[type="submit"], input[type="submit"]',
    resumeSelector: 'input[type="file"][name*="resume"], input[type="file"][name*="resume"]',
  },
  lever: {
    formSelector: ".postings-form",
    submitSelector: 'button[data-qa="btn-submit"], button[type="submit"]',
    resumeSelector: 'input[type="file"]',
  },
};

export function applyRuntimeSettings(settings: {
  llmProvider?: string;
  mockLLM?: boolean;
  slowMo?: number;
  geminiApiKey?: string;
  anthropicApiKey?: string;
  openaiApiKey?: string;
  openaiModel?: string;
  openaiBaseUrl?: string;
  geminiModel?: string;
  anthropicModel?: string;
}): void {
  if (settings.llmProvider) cfg.llmProvider = settings.llmProvider.toLowerCase();
  if (typeof settings.mockLLM === "boolean") cfg.mockLLM = settings.mockLLM;
  if (typeof settings.slowMo === "number") cfg.slowMo = settings.slowMo;
  if (settings.geminiApiKey) cfg.geminiApiKey = settings.geminiApiKey;
  if (settings.anthropicApiKey) cfg.anthropicApiKey = settings.anthropicApiKey;
  if (settings.openaiApiKey) cfg.openaiApiKey = settings.openaiApiKey;
  if (settings.openaiModel) cfg.openaiModel = settings.openaiModel;
  if (settings.openaiBaseUrl) cfg.openaiBaseUrl = settings.openaiBaseUrl;
  if (settings.geminiModel) cfg.geminiModel = settings.geminiModel;
  if (settings.anthropicModel) cfg.anthropicModel = settings.anthropicModel;
}
