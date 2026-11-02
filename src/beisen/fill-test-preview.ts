/** Fill a live Beisen form with clearly synthetic local test data, without saving. */
import { mkdirSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import ExcelJS from "exceljs";
import { chromium, type Locator } from "playwright";

const rawUrl = process.argv[2];
const sheetPath = process.argv[3];
if (!rawUrl || !sheetPath) throw new Error("Usage: npm run beisen:fill-test-preview -- '<Guoke form URL>' '<test personal sheet.xlsx>'");
const url = new URL(rawUrl);
if (!["https:", "http:"].includes(url.protocol) || url.hostname !== "goke.zhiye.com" ||
  url.pathname !== "/form" || !/^[0-9a-f-]{36}$/i.test(url.searchParams.get("jobAdId") || "")) {
  throw new Error("Only the Guoke Beisen form URL is supported in this pilot.");
}
url.protocol = "https:";
const workbook = new ExcelJS.Workbook();
await workbook.xlsx.readFile(sheetPath);
const basic = workbook.getWorksheet("基本信息");
const education = workbook.getWorksheet("教育经历");
const employment = workbook.getWorksheet("工作实习经历");
const projects = workbook.getWorksheet("项目经历");
if (!basic || !education || !employment || !projects) throw new Error("Test sheet is missing required tabs.");
const basicValue = (key: string) => {
  for (let row = 2; row <= basic.rowCount; row++) {
    if (basic.getRow(row).getCell(1).text.trim() === key) return basic.getRow(row).getCell(2).text.trim();
  }
  return "";
};
const name = basicValue("姓名");
const email = basicValue("邮箱");
if (!name.includes("测试") || !email.endsWith("@example.com")) {
  throw new Error("Test preview requires an obviously synthetic name and example.com email.");
}
const rows = (sheet: ExcelJS.Worksheet) => Array.from({ length: Math.max(sheet.rowCount - 1, 0) }, (_, i) =>
  Array.from({ length: sheet.columnCount }, (_, j) => sheet.getRow(i + 2).getCell(j + 1).text.trim()),
).filter((row) => row.some(Boolean));
const educationRows = rows(education);
const employmentRows = rows(employment);
const projectRows = rows(projects);
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const context = await chromium.launchPersistentContext(resolve("data/private/browser-profile"), {
  channel: "chrome", headless: false, acceptDownloads: false,
});
const page = context.pages()[0] || await context.newPage();
const results: Array<{ label: string; status: "filled" | "missing-field" | "failed" | "not-on-form" | "unsupported-value" }> = [];
try {
  await page.goto(url.toString(), { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.getByText("预览并提交", { exact: true }).waitFor({ timeout: 15000 });
  if (new URL(page.url()).pathname !== "/form") throw new Error("Application form is not open in the dedicated browser.");
  const item = (scope: Locator, label: string) => scope.locator(".form-item")
    .filter({ hasText: new RegExp(`^${escapeRegExp(label)}`) }).first();
  const fillText = async (scope: Locator, label: string, value: string, prefix = "") => {
    if (!value) return;
    const key = `${prefix}${label}`;
    const field = item(scope, label);
    const input = field.locator('input[type="text"], textarea').first();
    if (await field.count() !== 1 || await input.count() !== 1) {
      results.push({ label: key, status: "missing-field" }); return;
    }
    try {
      await input.fill(value);
      results.push({ label: key, status: (await input.inputValue()) === value ? "filled" : "failed" });
    } catch { results.push({ label: key, status: "failed" }); }
  };
  const fillMonth = async (scope: Locator, label: string, value: string, prefix: string) => {
    if (!value) return;
    const key = `${prefix}${label}`;
    const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(value);
    if (!match) { results.push({ label: key, status: "unsupported-value" }); return; }
    const field = item(scope, label);
    if (await field.count() !== 1) { results.push({ label: key, status: "missing-field" }); return; }
    try {
      await field.locator(".phoenix-select").click({ timeout: 5000 });
      await page.locator(".phoenix-calendar-month-panel-year-select").last().click({ timeout: 5000 });
      const year = Number(match[1]);
      for (let attempt = 0; attempt < 6; attempt++) {
        const years = (await page.locator(".phoenix-calendar-year-panel-year").allTextContents())
          .map((text) => Number(text.trim())).filter(Number.isFinite);
        if (years.includes(year)) break;
        if (!years.length) throw new Error("Year picker did not open");
        await page.locator(year < Math.min(...years) ? ".phoenix-calendar-year-panel-prev-decade-btn" : ".phoenix-calendar-year-panel-next-decade-btn").last().click();
      }
      await page.locator(".phoenix-calendar-year-panel-year").filter({ hasText: new RegExp(`^${year}$`) }).last().click({ timeout: 5000 });
      const month = Number(match[2]);
      await page.locator(".phoenix-calendar-month-panel-month").filter({ hasText: new RegExp(`^${month}月$`) }).last().click({ timeout: 5000 });
      results.push({ label: key, status: (await field.locator("input").first().inputValue()) === value ? "filled" : "failed" });
    } catch { results.push({ label: key, status: "failed" }); await page.keyboard.press("Escape").catch(() => {}); }
  };
  const fillSelect = async (scope: Locator, label: string, value: string, prefix: string) => {
    if (!value) return;
    const key = `${prefix}${label}`;
    const field = item(scope, label);
    if (await field.count() !== 1) { results.push({ label: key, status: "missing-field" }); return; }
    try {
      await field.locator(".phoenix-select").click({ timeout: 5000 });
      const option = page.locator(".phoenix-selectList__listItem").filter({ hasText: new RegExp(`^${escapeRegExp(value)}$`) });
      if (await option.count() !== 1) { results.push({ label: key, status: "unsupported-value" }); await page.keyboard.press("Escape"); return; }
      await option.click();
      results.push({ label: key, status: (await field.innerText()).includes(value) ? "filled" : "failed" });
    } catch { results.push({ label: key, status: "failed" }); await page.keyboard.press("Escape").catch(() => {}); }
  };
  const sections = (anchor: string) => page.locator(".form-part").filter({ hasText: anchor });
  const ensureSections = async (anchor: string, addLabel: string, count: number) => {
    for (let i = await sections(anchor).count(); i < count; i++) {
      await page.getByText(addLabel, { exact: true }).click({ timeout: 5000 });
    }
  };

  await fillText(page.locator("body"), "姓名", name);
  await fillText(page.locator("body"), "邮箱", email);
  await ensureSections("学校名称", "添加教育经历", educationRows.length);
  for (let i = 0; i < educationRows.length; i++) {
    const row = educationRows[i]; const scope = sections("学校名称").nth(i); const prefix = `教育经历${i + 1}：`;
    await fillText(scope, "学校名称", row[0], prefix);
    await fillMonth(scope, "开始时间", row[3], prefix);
    await fillMonth(scope, "结束时间", row[4], prefix);
    await fillText(scope, "专业名称", row[2], prefix);
    const degree = row[1];
    const level = degree === "学士" ? "本科" : degree === "硕士" ? "硕士研究生" : degree === "博士" ? "博士研究生" : "";
    await fillSelect(scope, "学历", level, prefix);
    await fillSelect(scope, "学位", degree, prefix);
  }
  await ensureSections("单位名称", "添加工作经历", employmentRows.length);
  for (let i = 0; i < employmentRows.length; i++) {
    const row = employmentRows[i]; const scope = sections("单位名称").nth(i); const prefix = `工作经历${i + 1}：`;
    await fillText(scope, "单位名称", row[0], prefix);
    await fillText(scope, "职位名称", row[1], prefix);
    await fillText(scope, "工作职责", row[4], prefix);
    if (row[2]) results.push({ label: `${prefix}开始时间`, status: "not-on-form" });
    if (row[3]) results.push({ label: `${prefix}结束时间`, status: "not-on-form" });
  }
  await ensureSections("项目名称", "添加项目经历", projectRows.length);
  for (let i = 0; i < projectRows.length; i++) {
    const row = projectRows[i]; const scope = sections("项目名称").nth(i); const prefix = `项目经历${i + 1}：`;
    await fillText(scope, "项目名称", row[0], prefix);
    await fillMonth(scope, "开始时间", row[2], prefix);
    await fillMonth(scope, "结束时间", row[3], prefix);
    await fillText(scope, "项目描述", row[4], prefix);
    await fillText(scope, "项目中职责", row[1], prefix);
  }
  mkdirSync(resolve("output"), { recursive: true });
  const reportPath = resolve("output/goke-beisen-test-fill-preview.json");
  writeFileSync(reportPath, JSON.stringify({
    mode: "synthetic-test-data", capturedAt: new Date().toISOString(), host: url.hostname, path: url.pathname,
    testDataFile: basename(sheetPath),
    rowCounts: { education: educationRows.length, employment: employmentRows.length, projects: projectRows.length },
    results, accountPhone: "preserved", uploads: "none", draftSave: "not-clicked", finalSubmission: "not-clicked",
  }, null, 2));
  console.log(`测试数据已填写 ${results.filter((item) => item.status === "filled").length} 项，报告：${reportPath}`);
  console.log("浏览器保持打开供你查看。未上传、暂存或投递；按 Ctrl+C 关闭本次预览。");
  await new Promise<void>((done) => { process.once("SIGINT", () => done()); process.once("SIGTERM", () => done()); });
} finally {
  await context.close();
}
