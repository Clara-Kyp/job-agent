import { NextRequest, NextResponse } from "next/server";
import { checkLocalRequest } from "../../../../intake/local-store";
import { defaultModel, loadLocalLLMSettings, saveLocalLLMSettings, validProvider } from "../../../../llm/local-settings";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  try { checkLocalRequest(request); const value = loadLocalLLMSettings(); return NextResponse.json({ provider: value?.provider || "deepseek", model: value?.model || "deepseek-flash", configured: Boolean(value?.apiKey), keyHint: value?.apiKey ? `••••${value.apiKey.slice(-4)}` : "" }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "设置读取失败" }, { status: 400 }); }
}
export async function POST(request: NextRequest) {
  try {
    checkLocalRequest(request); const body = await request.json() as Record<string, unknown>;
    const provider = String(body.provider || ""); if (!validProvider(provider)) throw new Error("请选择支持的模型服务商。");
    const previous = loadLocalLLMSettings();
    const apiKey = String(body.apiKey || "").trim() || previous?.apiKey || "";
    if (!apiKey || apiKey.length > 500) throw new Error("请输入有效的 API Key。");
    const model = String(body.model || defaultModel(provider)).trim(); if (!/^[\w.:-]{1,100}$/.test(model)) throw new Error("模型名称格式无效。");
    saveLocalLLMSettings({ provider, model, apiKey });
    return NextResponse.json({ provider, model, configured: true, keyHint: `••••${apiKey.slice(-4)}` });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "保存失败" }, { status: 400 }); }
}
