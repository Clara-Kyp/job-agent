import { NextRequest, NextResponse } from "next/server";
import { INTAKE_CATEGORIES, type IntakeCategory } from "../../../../intake/categories";
import { checkLocalRequest } from "../../../../intake/local-store";
import { readIntakeText } from "../../../../intake/read-file";
import { extractDocumentDetails } from "../../../../intake/extract-details";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    checkLocalRequest(request);
    const form = await request.formData();
    const file = form.get("file");
    const category = form.get("category");
    if (!(file instanceof File)) throw new Error("请选择需要解析的文件。");
    if (typeof category !== "string" || !INTAKE_CATEGORIES.some((entry) => entry.id === category)) throw new Error("资料类别无效。");
    const text = await readIntakeText(file);
    if (!text) return NextResponse.json({ details: extractDocumentDetails("", file.name, category as IntakeCategory), recognized: false, warning: "没有识别出可用文字，请手动核对并填写。" });
    const details = extractDocumentDetails(text, file.name, category as IntakeCategory);
    return NextResponse.json({ details, recognized: true, warning: "已从文件中提取候选信息，请逐项核对后再保存。" });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "文件解析失败。" }, { status: 400 });
  }
}
