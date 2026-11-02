import { NextRequest, NextResponse } from "next/server";
import { checkLocalRequest } from "../../../../intake/local-store";
import { loadLocalLLMSettings } from "../../../../llm/local-settings";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const allowed = new Set(["employment", "projects", "publications", "awards"]);
export async function POST(request: NextRequest) {
  try {
    checkLocalRequest(request);
    const body = await request.json() as Record<string, unknown>;
    const section = String(body.section || ""); if (!allowed.has(section)) throw new Error("此栏目暂不支持 AI 润色。");
    const row = body.row;
    if (!Array.isArray(row) || !row.some((cell) => typeof cell === "string" && cell.trim())) throw new Error("请先填写真实经历，再生成润色建议。");
    const fields = row.slice(0, 6).map((cell) => String(cell || "").slice(0, 1000));
    const instruction = String(body.instruction || "").slice(0, 1000);
    const previousDraft = String(body.previousDraft || "").slice(0, 2000);
    const settings = loadLocalLLMSettings(); if (!settings?.apiKey) throw new Error("请先在右上角设置中保存大模型 API Key。");
    const prompt = `请用中文润色以下求职档案内容。只能重述已给出的事实，不得补造量化成果、公司、技术、日期、职责、论文状态或奖项。保留原文的确定性，不确定事项不要推断。只返回一段可直接填入当前表格“内容/说明”字段的文字，不要解释。\n栏目：${section}\n原始行：${JSON.stringify(fields)}\n用户补充要求：${instruction || "无"}\n上一版草稿：${previousDraft || "无"}`;
    let draft = "";
    if (settings.provider === "deepseek" || settings.provider === "openai") {
      const { default: OpenAI } = await import("openai");
      const client = new OpenAI({ apiKey: settings.apiKey, ...(settings.provider === "deepseek" ? { baseURL: "https://api.deepseek.com" } : {}) });
      const result = await client.chat.completions.create({ model: settings.model, messages: [{ role: "user", content: prompt }], max_tokens: 800 });
      draft = result.choices[0]?.message?.content || "";
    } else if (settings.provider === "gemini") {
      const { GoogleGenerativeAI } = await import("@google/generative-ai");
      const result = await new GoogleGenerativeAI(settings.apiKey).getGenerativeModel({ model: settings.model }).generateContent(prompt);
      draft = result.response.text();
    } else {
      const { default: Anthropic } = await import("@anthropic-ai/sdk");
      const result = await new Anthropic({ apiKey: settings.apiKey }).messages.create({ model: settings.model, max_tokens: 800, messages: [{ role: "user", content: prompt }] });
      draft = result.content.filter((part) => part.type === "text").map((part) => part.text).join("\n");
    }
    draft = draft.trim().slice(0, 3000); if (!draft) throw new Error("模型没有返回可用文字，请重试。");
    return NextResponse.json({ draft, warning: "AI 建议可能有误，请核对每个事实后再应用。" });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "润色失败。" }, { status: 400 }); }
}
