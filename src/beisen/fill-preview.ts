/** Guoke Beisen pilot: fill verified text facts and hold the browser for review. */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import mammoth from "mammoth";
import { chromium } from "playwright";
import { loadProfile } from "../profile/profile-store.js";

const rawUrl = process.argv[2];
if (!rawUrl) throw new Error("Usage: npm run beisen:fill-preview -- '<Guoke form URL>'");
const url = new URL(rawUrl);
if (!["https:", "http:"].includes(url.protocol) || url.hostname !== "goke.zhiye.com" ||
  url.pathname !== "/form" || !/^[0-9a-f-]{36}$/i.test(url.searchParams.get("jobAdId") || "")) {
  throw new Error("This pilot accepts only a Guoke Beisen form URL with jobAdId.");
}
url.protocol = "https:";

const profile = loadProfile();
if (!profile || !profile.candidate.fullName || !profile.candidate.email || !existsSync(profile.resumePath)) {
  throw new Error("Please create a verified local candidate profile first.");
}
if (!/\.docx$/i.test(profile.resumePath)) throw new Error("This pilot expects the verified DOCX resume.");
const resumeText = (await mammoth.extractRawText({ path: profile.resumePath })).value;
const lines = resumeText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
const findAfter = (heading: string, predicate: (line: string) => boolean) => {
  const index = lines.findIndex((line) => line === heading);
  return index < 0 ? "" : lines.slice(index + 1, index + 8).find(predicate) || "";
};
const school = findAfter("教育背景", (line) => /大学/.test(line)).replace(/（.*$/, "").trim();
const majorLine = lines.find((line) => /数据科学方向/.test(line)) || "";
const major = /数据科学方向/.test(majorLine) ? "数据科学" : "";
const employer = findAfter("工作经历", (line) => /公司|集团|研究院/.test(line) && !/联系人/.test(line));
const employerIndex = lines.indexOf(employer);
const role = employerIndex < 0 ? "" : lines.slice(employerIndex + 1, employerIndex + 5)
  .find((line) => !/联系人|\d{8,}|^20\d\d[.年]/.test(line)) || "";
const firstWorkBullet = lines.find((line, index) => index > employerIndex && /^•/.test(line)) || "";
const projectLine = lines.find((line) => /^>> 产品二：/.test(line)) || "";
const projectName = projectLine.replace(/^>> 产品二：/, "").replace(/（.*$/, "").trim();
const projectIndex = lines.indexOf(projectLine);
const projectDescription = projectIndex < 0 ? "" : lines.slice(projectIndex + 1, projectIndex + 3).join(" ").trim();
const projectResponsibilities = projectIndex < 0 ? "" : (lines[projectIndex + 1] || "").trim();

const values: Array<[string, string]> = ([
  ["姓名", profile.candidate.fullName],
  ["邮箱", profile.candidate.email],
  ["学校名称", school],
  ["专业名称", major],
  ["单位名称", employer],
  ["职位名称", role],
  ["工作职责", firstWorkBullet.replace(/^•\s*/, "")],
  ["项目名称", projectName],
  ["项目描述", projectDescription],
  ["项目中职责", projectResponsibilities],
] as Array<[string, string]>).filter(([, value]) => value);

const context = await chromium.launchPersistentContext(resolve("data/private/browser-profile"), {
  channel: "chrome", headless: false, acceptDownloads: false,
});
const page = context.pages()[0] || await context.newPage();
const results: Array<{ label: string; status: "filled" | "already-filled" | "preserved-existing" | "missing-field" | "failed" }> = [];
try {
  await page.goto(url.toString(), { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.getByText("预览并提交", { exact: true }).waitFor({ timeout: 15000 });
  if (new URL(page.url()).pathname !== "/form") throw new Error("Application form is not open; log in to the dedicated browser first.");
  for (const [label, value] of values) {
    const items = page.locator(".form-item").filter({ has: page.locator("label.form-item__text").filter({ hasText: new RegExp(`^${label}$`) }) });
    if (await items.count() !== 1) { results.push({ label, status: "missing-field" }); continue; }
    const input = items.locator('input[type="text"], textarea').first();
    if (await input.count() !== 1) { results.push({ label, status: "missing-field" }); continue; }
    const existing = (await input.inputValue()).trim();
    if (existing === value) { results.push({ label, status: "already-filled" }); continue; }
    if (existing) { results.push({ label, status: "preserved-existing" }); continue; }
    try {
      await input.fill(value);
      results.push({ label, status: (await input.inputValue()) === value ? "filled" : "failed" });
    } catch { results.push({ label, status: "failed" }); }
  }
  const phone = page.locator(".form-item").filter({ has: page.locator("label.form-item__text").filter({ hasText: /^手机号$/ }) }).locator('input[type="text"]').first();
  const phoneStatus = await phone.count() && (await phone.inputValue()).trim() ? "preserved-existing" : "left-blank";
  mkdirSync(resolve("output"), { recursive: true });
  const reportPath = resolve("output/goke-beisen-fill-preview.json");
  writeFileSync(reportPath, JSON.stringify({
    capturedAt: new Date().toISOString(), host: url.hostname, path: url.pathname,
    results, phone: phoneStatus, resumeUpload: "skipped-role-mismatch",
    finalSubmission: "not-clicked", draftSave: "not-clicked",
  }, null, 2));
  console.log(`已填写 ${results.filter((item) => item.status === "filled").length} 项；完整状态见 ${reportPath}`);
  console.log("浏览器保持打开供你核对。没有点击暂存、预览并提交或最终投递。按 Ctrl+C 关闭本次预览。");
  await new Promise<void>((done) => { process.once("SIGINT", () => done()); process.once("SIGTERM", () => done()); });
} finally {
  await context.close();
}
