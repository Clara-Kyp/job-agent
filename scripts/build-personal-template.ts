import ExcelJS from "exceljs";
import { resolve } from "node:path";
import { BASIC_FIELDS } from "../src/intake/personal-sheet.js";
import { RESUME_SECTIONS } from "../src/intake/structured-profile.js";

const workbook = new ExcelJS.Workbook();
workbook.creator = "Job Agent";
const guide = workbook.addWorksheet("填写说明");
guide.columns = [{ width: 100 }];
[
  "Job Agent 个人信息表",
  "请填写“基本信息”和各经历工作表；没有的项目留空，不要编造。",
  "现职四项可在“基本信息”页填写，也可在“求职意向”页填写；两处若都填写，内容必须相同。",
  "没有当前工作时，现从事行业、现从事职业和现月薪可填“无”，现工作城市留空。",
  "填写完成后，将本文件与简历、证明材料一起放入资料包 ZIP 上传。",
].forEach((text) => guide.addRow([text]));

const basic = workbook.addWorksheet("基本信息");
basic.columns = [{ width: 33 }, { width: 43 }, { width: 55 }];
basic.addRow(["字段", "填写内容", "填写说明"]);
for (const [key, label] of BASIC_FIELDS) {
  const hint = key === "currentMonthlySalary" ? "人民币元/月；没有当前工作可填“无”" :
    key === "currentWorkCity" ? "实际工作城市；没有当前工作可留空" :
    key === "currentIndustry" || key === "currentOccupation" ? "没有当前工作可填“无”" : "";
  basic.addRow([label, "", hint]);
}

const titles: Record<string, string> = {
  education: "教育经历", employment: "工作实习经历", projects: "项目经历",
  publications: "论文发表成果", certifications: "语言技能证书", awards: "奖项荣誉",
  jobPreferences: "求职意向", languageAbility: "语言能力",
};
for (const section of RESUME_SECTIONS) {
  const sheet = workbook.addWorksheet(titles[section.id]);
  sheet.columns = section.columns.map(() => ({ width: 25 }));
  sheet.addRow([...section.columns]);
  for (let i = 0; i < 30; i++) sheet.addRow([]);
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF26754E" } };
  sheet.getRow(1).height = 28;
}
basic.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
basic.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF26754E" } };
basic.getRow(1).height = 28;
basic.views = [{ state: "frozen", ySplit: 1 }];
guide.getRow(1).font = { bold: true, size: 16, color: { argb: "FF26754E" } };

await workbook.xlsx.writeFile(resolve("public/templates/job-agent-personal-profile.xlsx"));
