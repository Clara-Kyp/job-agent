import { cfg } from "../config.js";
import { GeminiProvider } from "./gemini.js";
import { OpenAIProvider } from "./openai.js";
import { AnthropicProvider } from "./anthropic.js";

/**
 * Minimal provider surface every LLM backend implements. Callers never touch
 * a vendor SDK — they hand a prompt to `generate()` and get text back.
 */
export interface LLMProvider {
  /**
   * Run a completion and return the raw text.
   * @param opts.json   When true, request structured JSON output where the
   *                    backend supports it (Gemini responseMimeType, OpenAI
   *                    response_format, Anthropic type hint).
   * @param opts.temperature Overrides the configured default temperature.
   */
  generate(prompt: string, opts?: { json?: boolean; temperature?: number }): Promise<string>;
}

/** The provider selected by LLM_PROVIDER (default "gemini"). */
export function createProvider(): LLMProvider {
  switch (cfg.llmProvider) {
    case "gemini":
      return new GeminiProvider();
    case "openai":
      return new OpenAIProvider();
    case "anthropic":
      return new AnthropicProvider();
    default:
      throw new Error(
        `Unknown LLM_PROVIDER: "${cfg.llmProvider}" (expected gemini | openai | anthropic)`
      );
  }
}

let provider: LLMProvider | null = null;

export function resetLLMProvider(): void {
  provider = null;
}

/** Lazily-created, process-wide provider instance. */
export function getLLM(): LLMProvider {
  if (!provider) provider = createProvider();
  return provider;
}