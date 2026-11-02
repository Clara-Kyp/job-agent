import { NextRequest, NextResponse } from "next/server";
import { readArchive } from "../../../../../intake/archive";
import { checkLocalRequest } from "../../../../../intake/local-store";
import { readResume } from "../../../../../intake/parse-resume";
import { readIntakeText } from "../../../../../intake/read-file";
import { parsePersonalSheet } from "../../../../../intake/personal-sheet";
import { mergeSupportingIntoTable } from "../../../../../intake/supporting-to-table";
import { extractDocumentDetails } from "../../../../../intake/extract-details";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: NextRequest) {
  try {
    checkLocalRequest(request);
    const form = await request.formData(), archive = form.get("archive");
    if (!(archive instanceof File)) throw new Error("请选择 ZIP 资料包。");
    const { entries, personalSheet, warnings } = await readArchive(archive);
    const formProfile = await parsePersonalSheet(personalSheet);
    const resume = entries.find((entry) => entry.category === "resume")!;
    const parsed = await readResume(resume.file);
    const inventory = [];
    for (const entry of entries) {
      if (entry.category === "identity") { inventory.push({ path: entry.path, category: entry.category, details: null, preview: "证件资料仅在确认保存后保存在本机，不进行文字解析。" }); continue; }
      if (entry.category === "resume") { inventory.push({ path: entry.path, category: entry.category, details: null, preview: "简历已解析，请在下一步核对表格。" }); continue; }
      try {
        const content = await readIntakeText(entry.file);
        inventory.push({ path: entry.path, category: entry.category, details: extractDocumentDetails(content, entry.file.name, entry.category), preview: content.slice(0, 500) });
        if (!content) warnings.push(`${entry.path}：未识别到文字，请核对原文件`);
      } catch (error) { warnings.push(`${entry.path}：${error instanceof Error ? error.message : "解析失败"}`); inventory.push({ path: entry.path, category: entry.category, details: extractDocumentDetails("", entry.file.name, entry.category), preview: "未能解析，请人工核对。" }); }
    }
    const dates = (value: string) => (value.match(/(?:19|20)\d{2}(?:[-./年]\d{1,2})?/g) || []);
    const parsedName = parsed.name === "Unknown" ? "" : parsed.name.replace(/^(?:姓名|name)\s*[：:]\s*/i, "");
    if (parsedName && formProfile.confirmed.fullName !== parsedName) warnings.push(`个人信息表姓名“${formProfile.confirmed.fullName}”与简历识别姓名“${parsedName}”不一致，请核对。`);
    const resumeTable = { ...formProfile.resumeTable };
    if (!resumeTable.education?.length) resumeTable.education = parsed.education.map((item) => [item.school, item.degree, item.details || "", dates(item.year)[0] || "", dates(item.year)[1] || "", ""]);
    if (!resumeTable.employment?.length) resumeTable.employment = parsed.experience.map((item) => [item.company, item.title, dates(item.duration)[0] || "", dates(item.duration)[1] || "", item.description]);
    const merged = mergeSupportingIntoTable(resumeTable, inventory);
    for (const path of merged.unmappedPaths) warnings.push(`${path}：无法可靠判断应放入哪类简历表格，已保留在材料核对区。`);
    return NextResponse.json({ candidate: { ...formProfile.confirmed, email: formProfile.confirmed.email || parsed.email, phone: formProfile.confirmed.phone || parsed.phone }, resumeTable: merged.table, facts: { education: parsed.education.length, experience: parsed.experience.length, skills: parsed.skills.length }, inventory, warnings });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "资料包解析失败。" }, { status: 400 }); }
}
