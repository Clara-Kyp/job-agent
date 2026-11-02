import type { IntakeCategory } from "./categories.js";
import type { DocumentDetails, ResumeSectionId, ResumeTable } from "./structured-profile.js";

export interface ParsedSupportingDocument {
  path: string;
  category: IntakeCategory | "resume";
  details: DocumentDetails | null;
  preview: string;
}

function line(text: string, labels: string[]): string {
  for (const label of labels) {
    const match = text.match(new RegExp(`^${label}\\s*[：:]\\s*(.+)$`, "im"));
    if (match) return match[1].trim().slice(0, 1000);
  }
  return "";
}

function proposedRow(item: ParsedSupportingDocument): { section: ResumeSectionId; row: string[] } | null {
  const { category, details, path, preview } = item;
  if (!details || !preview || preview.startsWith("未能解析")) return null;
  if (category === "language") {
    return { section: "certifications", row: [details.title, details.scoreOrResult, details.issuedAt, details.expiresAt, [details.issuer, details.notes].filter(Boolean).join("；")] };
  }
  if (category !== "achievements") return null;
  const filename = path.split("/").pop() || "";
  if (/^(?:论文|paper|publication)[_\s-]/i.test(filename) || /^(?:论文题目|发表状态)\s*[：:]/m.test(preview)) {
    return { section: "publications", row: [details.title, line(preview, ["作者顺序", "作者贡献", "authorOrder"] ) || details.scoreOrResult, details.issuer === "无" ? "" : details.issuer, details.issuedAt, line(preview, ["DOI", "链接", "url"]), line(preview, ["发表状态", "状态", "status"]) || details.notes] };
  }
  if (/^(?:奖项|获奖|荣誉|award)[_\s-]/i.test(filename) || /^(?:奖项名称|获奖名称)\s*[：:]/m.test(preview)) {
    return { section: "awards", row: [details.title, details.issuer, details.issuedAt, details.scoreOrResult, details.notes] };
  }
  if (/^(?:项目|作品|project)[_\s-]/i.test(filename) || /^(?:项目名称|作品名称)\s*[：:]/m.test(preview)) {
    return { section: "projects", row: [details.title, line(preview, ["担任角色", "角色"]), line(preview, ["开始时间"]), line(preview, ["结束时间", "完成日期"]) || details.issuedAt, line(preview, ["工作内容", "项目内容", "说明", "贡献"]) || details.notes, line(preview, ["项目链接", "链接", "url"]) ] };
  }
  return null;
}

export function mergeSupportingIntoTable(table: ResumeTable, inventory: ParsedSupportingDocument[]): { table: ResumeTable; mappedPaths: string[]; unmappedPaths: string[] } {
  const merged: ResumeTable = Object.fromEntries(Object.entries(table).map(([key, rows]) => [key, rows.map((row) => [...row])])) as ResumeTable;
  const mappedPaths: string[] = [], unmappedPaths: string[] = [];
  for (const item of inventory) {
    if (item.category !== "language" && item.category !== "achievements") continue;
    const proposal = proposedRow(item);
    if (!proposal || !proposal.row[0]) { unmappedPaths.push(item.path); continue; }
    const rows = merged[proposal.section] || [];
    const title = proposal.row[0].replace(/\s/g, "").toLowerCase();
    const match = rows.find((row) => row[0].replace(/\s/g, "").toLowerCase() === title);
    if (match) proposal.row.forEach((value, index) => { if (!match[index] && value) match[index] = value; });
    else rows.push(proposal.row);
    merged[proposal.section] = rows;
    mappedPaths.push(item.path);
  }
  return { table: merged, mappedPaths, unmappedPaths };
}
