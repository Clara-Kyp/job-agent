import { cfg } from "../config.js";
import type { LLMProvider } from "./provider.js";

/**
 * OpenAI-backed provider. The SDK is loaded lazily so Gemini-only installs
 * never pay the import cost, and are unaffected if `openai` is absent.
 */
export class OpenAIProvider implements LLMProvider {
  async generate(
    prompt: string,
    opts?: { json?: boolean; temperature?: number }
  ): Promise<string> {
    if (!cfg.openaiApiKey) {
      throw new Error("LLM_PROVIDER=openai requires OPENAI_API_KEY in .env");
    }

    // Dynamic import keeps `openai` out of the critical path for Gemini users.
    const { default: OpenAI } = await import("openai");
    const client = new OpenAI({
      apiKey: cfg.openaiApiKey,
      ...(cfg.openaiBaseUrl ? { baseURL: cfg.openaiBaseUrl } : {}),
    });

    const params: Record<string, unknown> = {
      model: cfg.openaiModel,
      temperature: opts?.temperature ?? cfg.geminiTemp,
      messages: [{ role: "user", content: prompt }],
    };
    if (opts?.json) params.response_format = { type: "json_object" };

    const res = await client.chat.completions.create(
      params as never // narrow to the SDK's huge param type; shape is stable
    );
    return res.choices[0]?.message?.content ?? "";
  }
}
