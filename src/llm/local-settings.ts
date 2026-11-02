import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
export type LocalLLMProvider = "deepseek" | "openai" | "gemini" | "anthropic";
export type LocalLLMSettings = { provider: LocalLLMProvider; model: string; apiKey: string };
const path = resolve(process.cwd(), "data/private/llm-settings.json");
const defaults: Record<LocalLLMProvider, string> = { deepseek: "deepseek-flash", openai: "gpt-4o-mini", gemini: "gemini-1.5-flash", anthropic: "claude-3-5-sonnet-latest" };
export function defaultModel(provider: LocalLLMProvider): string { return defaults[provider]; }
export function loadLocalLLMSettings(): LocalLLMSettings | null {
  if (!existsSync(path)) return null;
  const value = JSON.parse(readFileSync(path, "utf8")) as LocalLLMSettings;
  if (!Object.hasOwn(defaults, value.provider) || typeof value.apiKey !== "string") return null;
  return value;
}
export function saveLocalLLMSettings(value: LocalLLMSettings): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, JSON.stringify(value), { mode: 0o600 }); chmodSync(path, 0o600);
}
export function validProvider(value: string): value is LocalLLMProvider { return Object.hasOwn(defaults, value); }
