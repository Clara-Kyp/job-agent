import { cfg } from "../config.js";
import type { LLMProvider } from "./provider.js";

/**
 * Anthropic (Claude) provider. SDK is loaded lazily like OpenAI's so it never
 * weighs down Gemini-only installs. JSON output is requested via the prompt;
 * our shared parser handles any markdown fences.
 */
export class AnthropicProvider implements LLMProvider {
  async generate(
    prompt: string,
    opts?: { json?: boolean; temperature?: number }
  ): Promise<string> {
    if (!cfg.anthropicApiKey) {
      throw new Error("LLM_PROVIDER=anthropic requires ANTHROPIC_API_KEY in .env");
    }

    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic({ apiKey: cfg.anthropicApiKey });

    const res = await client.messages.create({
      model: cfg.anthropicModel,
      max_tokens: 4096,
      temperature: opts?.temperature ?? cfg.geminiTemp,
      messages: [{ role: "user", content: prompt }],
    });

    return res.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("");
  }
}