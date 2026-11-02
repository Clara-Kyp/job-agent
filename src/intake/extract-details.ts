import { basename, extname } from "node:path";
import type { IntakeCategory } from "./categories.js";
import { EMPTY_DOCUMENT_DETAILS, type DocumentDetails } from "./structured-profile.js";

function labelled(text: string, labels: string[]): string {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (const label of labels) {
    for (const line of lines) {
      const expression = new RegExp(`^(?:${label})\\s*[：:]\\s*(.+)$`, "i");
      const found = line.match(expression);
      if (found) return found[1].trim().slice(0, 200);
    }
  }
  return "";
}

function normalizedDate(value: string): string {
  const match = value.match(/(20\d{2}|19\d{2})[年./-]\s*(\d{1,2})(?:[月./-]\s*(\d{1,2}))?/);
  if (match) return `${match[1]}-${match[2].padStart(2, "0")}${match[3] ? `-${match[3].padStart(2, "0")}` : ""}`;
  return "";
}

export function extractDocumentDetails(text: string, filename: string, category: IntakeCategory): DocumentDetails {
  const titleFromFile = basename(filename, extname(filename));
  const title = labelled(text, ["论文题目", "项目名称", "奖项名称", "证书名称", "考试名称", "考试", "材料名称", "项目", "title"]);
  const dateRaw = labelled(text, ["取得日期", "获得日期", "考试日期", "测试日期", "发表日期", "录用日期", "签发日期", "颁发日期", "issuedAt", "date"]);
  const issuer = labelled(text, ["颁发机构", "颁发单位", "学校", "单位", "期刊", "会议", "机构", "issuer", "venue"]);
  const score = labelled(text, ["总分", "成绩", "分数", "等级", "作者顺序", "作者贡献", "score", "authorOrder"]);
  const expiresRaw = labelled(text, ["有效期至", "到期日期", "失效日期", "expiresAt"]);
  const doi = labelled(text, ["DOI", "链接", "url"]);
  const status = labelled(text, ["状态", "发表状态", "status"]);
  const notes = [doi && `链接/DOI：${doi}`, status && `状态：${status}`].filter(Boolean).join("；");
  return {
    ...EMPTY_DOCUMENT_DETAILS,
    title: title || titleFromFile,
    issuedAt: normalizedDate(dateRaw),
    issuer,
    scoreOrResult: score,
    expiresAt: normalizedDate(expiresRaw),
    notes: notes || (category === "achievements" ? labelled(text, ["说明", "贡献"]) : ""),
  };
}
