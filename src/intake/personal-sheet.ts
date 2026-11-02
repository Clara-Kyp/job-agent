import ExcelJS from "exceljs";
import { RESUME_SECTIONS, type ResumeTable } from "./structured-profile.js";

export const PERSONAL_SHEET_NAME = "个人信息表.xlsx";
const SHEET_TITLES: Record<string, string> = { education: "教育经历", employment: "工作实习经历", projects: "项目经历", publications: "论文发表成果", certifications: "语言技能证书", awards: "奖项荣誉", jobPreferences: "求职意向", languageAbility: "语言能力" };
export const BASIC_FIELDS = [
  ["fullName", "姓名"], ["email", "邮箱"], ["phone", "手机号"],
  ["city", "当前城市"], ["country", "国家或地区"], ["locationPreference", "求职意向地"],
  ["desiredSalary", "期望薪资"], ["earliestStartDate", "最早到岗时间"],
  ["visaStatus", "签证或工作许可状态"], ["sponsorship", "是否需要雇主签证担保"],
  ["gender", "性别"], ["hometown", "籍贯"], ["birthDate", "出生日期（YYYY-MM-DD）"],
  ["workYears", "工作年限"], ["desiredIndustry", "期望从事行业"],
  ["desiredOccupation", "期望从事职业"], ["desiredMonthlySalary", "期望税前月薪（人民币）"],
  ["currentIndustry", "现从事行业"], ["currentOccupation", "现从事职业"],
  ["currentWorkCity", "现工作城市"], ["currentMonthlySalary", "现月薪（税前，人民币）"],
] as const;
export type PersonalConfirmed = Record<(typeof BASIC_FIELDS)[number][0], string>;

function cellText(cell: ExcelJS.Cell, max = 1000): string {
  const value = cell.value;
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number") return String(value).trim().slice(0, max);
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object" && "richText" in value && Array.isArray(value.richText)) {
    return value.richText.map((part) => typeof part.text === "string" ? part.text : "").join("").trim().slice(0, max);
  }
  throw new Error(`个人信息表 ${cell.address} 仅支持直接输入文字或日期，不能使用公式或链接。`);
}

export async function parsePersonalSheet(file: File): Promise<{ confirmed: PersonalConfirmed; resumeTable: ResumeTable }> {
  if (file.name !== PERSONAL_SHEET_NAME || file.size === 0 || file.size > 2 * 1024 * 1024) throw new Error(`请使用模板中的 ${PERSONAL_SHEET_NAME}，大小不超过 2 MB。`);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(await file.arrayBuffer()) as never);
  const basic = workbook.getWorksheet("基本信息");
  if (!basic) throw new Error("个人信息表缺少“基本信息”工作表，请重新下载模板。");
  if (cellText(basic.getCell("A1")) !== "字段" || cellText(basic.getCell("B1")) !== "填写内容") throw new Error("个人信息表的基本信息表头被改动，请使用原模板。");
  const confirmed = {} as PersonalConfirmed;
  for (const [index, [key, label]] of BASIC_FIELDS.entries()) {
    const row = index + 2;
    const found = cellText(basic.getCell(row, 1));
    if (found !== label && !(index >= 10 && !found)) throw new Error(`基本信息第 ${row} 行字段名称被改动：应为 ${label}。`);
    confirmed[key] = found ? cellText(basic.getCell(row, 2), 200) : "";
  }
  if (!confirmed.fullName) throw new Error("请先在个人信息表“基本信息”填写姓名。");
  const sponsorship = confirmed.sponsorship.replace(/\s/g, "");
  if (!["", "是", "否", "未知", "yes", "no", "unknown"].includes(sponsorship.toLowerCase()) && !["是", "否", "未知"].includes(sponsorship)) throw new Error("签证担保请填写“是”“否”或“未知”。");
  confirmed.sponsorship = ["是", "yes"].includes(sponsorship.toLowerCase()) ? "yes" : ["否", "no"].includes(sponsorship.toLowerCase()) ? "no" : "unknown";
  const resumeTable: ResumeTable = {};
  for (const section of RESUME_SECTIONS) {
    const sheet = workbook.getWorksheet(SHEET_TITLES[section.id]);
    if (!sheet && ["jobPreferences", "languageAbility"].includes(section.id)) { resumeTable[section.id] = []; continue; }
    if (!sheet) throw new Error(`个人信息表缺少“${SHEET_TITLES[section.id]}”工作表，请使用原模板。`);
    for (const [index, header] of section.columns.entries()) if (cellText(sheet.getCell(1, index + 1)) !== header) throw new Error(`“${section.title}”表头被改动，请使用原模板。`);
    const rows: string[][] = [];
    for (let rowIndex = 2; rowIndex <= 31; rowIndex++) {
      const row = section.columns.map((_, index) => cellText(sheet.getCell(rowIndex, index + 1)));
      if (row.some(Boolean)) rows.push(row);
    }
    if (sheet.actualRowCount > 31) throw new Error(`“${section.title}”最多填写 30 行。`);
    resumeTable[section.id] = rows;
  }
  const currentFields = [confirmed.currentIndustry, confirmed.currentOccupation, confirmed.currentWorkCity, confirmed.currentMonthlySalary];
  if (currentFields.some(Boolean)) {
    const preferences = resumeTable.jobPreferences || [];
    if (!preferences.length) preferences.push(Array(RESUME_SECTIONS.find((section) => section.id === "jobPreferences")!.columns.length).fill(""));
    for (let index = 0; index < currentFields.length; index++) {
      const value = currentFields[index];
      if (!value) continue;
      if (preferences[0][index] && preferences[0][index] !== value) throw new Error(`“基本信息”与“求职意向”的${BASIC_FIELDS[17 + index][1]}不一致，请核对后再上传。`);
      preferences[0][index] = value;
    }
    resumeTable.jobPreferences = preferences;
  }
  return { confirmed, resumeTable };
}
