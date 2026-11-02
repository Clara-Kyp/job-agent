import { GoogleGenerativeAI } from "@google/generative-ai";
import { cfg } from "../config.js";
import type { LLMProvider } from "./provider.js";

/**
 * Gemini-backed provider. Preserves the exact behavior of the original
 * hardwired client: JSON responses via `responseMimeType`, temperature from
 * config unless overridden per request.
 */
export class GeminiProvider implements LLMProvider {
  private genAI: GoogleGenerativeAI;

  constructor() {
    this.genAI = new GoogleGenerativeAI(cfg.geminiApiKey);
  }

  async generate(
    prompt: string,
    opts?: { json?: boolean; temperature?: number }
  ): Promise<string> {
    const model = this.genAI.getGenerativeModel({
      model: cfg.geminiModel,
      generationConfig: {
        temperature: opts?.temperature ?? cfg.geminiTemp,
        ...(opts?.json ? { responseMimeType: "application/json" } : {}),
      },
    });

    const result = await model.generateContent(prompt);
    return result.response.text();
  }
}