/** Local Guoke Beisen integration. Fills verified profile facts and stops for review. */
import { type BrowserContext, type Locator, type Page } from "playwright";
import { resolve } from "node:path";
import { launchReviewBrowser } from "../filler/review-browser.js";
import { loadProfile } from "../profile/profile-store.js";
import type { CandidateProfile } from "../types/index.js";
import { resolveSiteChoice } from "./field-routing.js";

type ResultStatus = "filled" | "already-filled" | "preserved-existing" | "missing-field" | "unsupported-value" | "failed" | "not-on-form" | "not-applicable";
export interface BeisenFillResult {
  label: string;
  status: ResultStatus;
  detail?: string;
}
export interface BeisenProfileResult {
  status: "review";
  job: { url: string; company: string; title: string };
  resume: { email: string };
  evaluation: { score: number; recommendation: string; fitAnalysis: string; matchStrengths: string[]; matchGaps: string[] };
  draftedAnswers: [];
  filled: number;
  skipped: number;
  failed: number;
  beisen: { results: BeisenFillResult[]; unresolved: string[]; resumeUpload: string };
}

let reviewContext: BrowserContext | null = null;
let active = false;

export async function closeBeisenReview(): Promise<void> {
  if (reviewContext) {
    await reviewContext.close();
    reviewContext = null;
  }
}

const exact = (text: string) => new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);
const starts = (text: string) => new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`);

export async function runBeisenProfile(input: {
  url: string;
  resumePath: string;
  uploadSelectedResume: boolean;
  profilePath?: string;
  onProgress: (stage: string, message: string) => void | Promise<void>;
}): Promise<BeisenProfileResult> {
  if (active) throw new Error("已有国科微填写任务正在运行，请先完成当前任务。");
  const url = new URL(input.url);
  if (url.protocol !== "https:" || url.hostname !== "goke.zhiye.com" || url.pathname !== "/form" ||
    !/^[0-9a-f-]{36}$/i.test(url.searchParams.get("jobAdId") || "")) {
    throw new Error("目前只支持国科微的具体北森申请表链接。");
  }
  const profile = loadProfile(input.profilePath);
  if (!profile?.candidate.fullName || !profile.candidate.email) throw new Error("请先在网页完成并核对个人档案。");
  active = true;
  let context: BrowserContext | null = null;
  let page: Page;
  const results: BeisenFillResult[] = [];
  const record = (label: string, status: ResultStatus, detail?: string) => {
    const previous = results.findIndex((result) => result.label === label);
    if (previous >= 0) results.splice(previous, 1);
    results.push({ label, status, detail });
  };
  const optionNodes = () => page.locator('.phoenix-selectList__listItem:visible, [role="option"]:visible');
  const visibleChoiceList = async () => (await optionNodes().allTextContents()).map((choice) => choice.trim()).filter(Boolean);
  const visibleChoices = async () => (await visibleChoiceList()).slice(0, 20).join("、");
  const selectorModal = () => page.locator(".constant-main-selector-container:visible, .area-selector-container:visible").last();
  const dismissSelector = async () => {
    const modal = selectorModal();
    if (await modal.count()) {
      await modal.getByText("取消", { exact: true }).click({ timeout: 2000 }).catch(() => {});
      await modal.waitFor({ state: "hidden", timeout: 2000 }).catch(() => {});
    }
    if (await optionNodes().count()) await page.keyboard.press("Escape").catch(() => {});
  };
  const item = (scope: Locator, label: string) => scope.locator(".form-item").filter({ hasText: starts(label) }).first();
  const sections = (anchor: string) => page.locator(".form-part").filter({ hasText: anchor });
  const fillText = async (scope: Locator, label: string, value: string, prefix = "") => {
    if (!value.trim()) return;
    const key = `${prefix}${label}`;
    const field = item(scope, label);
    const control = field.locator('input[type="text"], textarea').first();
    if (await field.count() !== 1 || await control.count() !== 1) { record(key, "missing-field"); return; }
    try {
      const existing = (await control.inputValue()).trim();
      if (existing === value) { record(key, "already-filled"); return; }
      if (existing) { record(key, "preserved-existing"); return; }
      await control.fill(value);
      record(key, (await control.inputValue()) === value ? "filled" : "failed");
    } catch { record(key, "failed"); }
  };
  const fillMonth = async (scope: Locator, label: string, value: string, prefix: string) => {
    if (!value.trim()) return;
    const key = `${prefix}${label}`;
    const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(value.trim());
    if (!match) { record(key, "unsupported-value"); return; }
    const field = item(scope, label);
    if (await field.count() !== 1) { record(key, "missing-field"); return; }
    try {
      const existing = await field.locator("input").first().inputValue();
      if (existing === value) { record(key, "already-filled"); return; }
      if (existing) { record(key, "preserved-existing"); return; }
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
      await page.locator(".phoenix-calendar-year-panel-year").filter({ hasText: exact(String(year)) }).last().click({ timeout: 5000 });
      await page.locator(".phoenix-calendar-month-panel-month").filter({ hasText: exact(`${Number(match[2])}月`) }).last().click({ timeout: 5000 });
      record(key, (await field.locator("input").first().inputValue()) === value ? "filled" : "failed");
    } catch { record(key, "failed"); await page.keyboard.press("Escape").catch(() => {}); }
  };
  const fillSelect = async (scope: Locator, label: string, value: string, prefix: string) => {
    if (!value.trim()) return;
    const key = `${prefix}${label}`;
    const field = item(scope, label);
    if (await field.count() !== 1) { record(key, "missing-field"); return; }
    try {
      if ((await field.innerText()).includes(value)) { record(key, "already-filled"); return; }
      await field.locator(".phoenix-select").click({ timeout: 5000 });
      const modal = selectorModal();
      if (await modal.count()) {
        await modal.locator(".list-item-container").first().waitFor({ state: "visible", timeout: 4000 }).catch(() => {});
        const scan = async (target: string) => {
          const seen = new Set<string>();
          for (let attempt = 0; attempt < 7; attempt++) {
            const items = modal.locator(".list-item-container:visible");
            const current = (await items.allTextContents()).map((text) => text.trim());
            for (const text of current) seen.add(text);
            const found = resolveSiteChoice(label, target, current);
            if (found.status === "matched") return { resolution: found, choices: [...seen] };
            if (await items.count()) { await items.last().hover(); await page.mouse.wheel(0, 500); await page.waitForTimeout(120); }
          }
          return { resolution: resolveSiteChoice(label, target, [...seen]), choices: [...seen] };
        };
        if (label === "期望从事职业" && value === "数据分析师") {
          const category = await scan("计算机·网络·技术类");
          if (category.resolution.status === "matched") await modal.locator(".list-item-container:visible").filter({ hasText: exact(category.resolution.option) }).click({ timeout: 3000 });
        }
        const target = label === "期望从事行业" && value === "电子/半导体/集成电路" ? "电子/微电子" : value;
        const { resolution, choices } = await scan(target);
        if (resolution.status !== "matched") {
          record(key, "unsupported-value", `目标“${value}”；此控件为分级弹窗，当前层可见选项：${choices.slice(0, 20).join("、") || "无"}`);
          return;
        }
        const option = modal.locator(".list-item-container").filter({ hasText: exact(resolution.option) });
        if (await option.count() !== 1) { record(key, "unsupported-value", "匹配选项不唯一"); return; }
        const checkbox = option.locator(".icon-container");
        if (await checkbox.count() === 1) await checkbox.click({ timeout: 3000 });
        else await option.click({ timeout: 3000 });
        if (await modal.locator(".select-data-num-text").first().innerText().catch(() => "0") === "0") {
          record(key, "unsupported-value", `“${resolution.option}”是分类节点，需要选择具体子项`);
          return;
        }
        await modal.getByText("确定", { exact: true }).click({ timeout: 3000 });
        record(key, (await field.innerText()).includes(resolution.option) ? "filled" : "failed");
        return;
      }
      const resolution = resolveSiteChoice(label, value, await visibleChoiceList());
      if (resolution.status !== "matched") { record(key, "unsupported-value", `目标“${value}”；${resolution.reason === "ambiguous" ? "多个候选" : "可见选项"}：${resolution.candidates.slice(0, 20).join("、") || "无"}`); return; }
      const option = optionNodes().filter({ hasText: exact(resolution.option) });
      if (await option.count() !== 1) { record(key, "unsupported-value", `匹配到“${resolution.option}”但选项控件不唯一`); return; }
      await option.click();
      record(key, (await field.innerText()).includes(resolution.option) ? "filled" : "failed");
    } catch (error) { record(key, "failed", error instanceof Error ? error.message.slice(0, 180) : String(error)); }
    finally { await dismissSelector(); }
  };
  const fillHometown = async (value: string) => {
    if (!value.trim()) return;
    const match = /^(.*?(?:省|自治区|特别行政区))(.+?市)(.+?[区县])?$/.exec(value.trim());
    if (!match) { await fillSelect(page.locator("body"), "籍贯", value, ""); return; }
    const field = item(page.locator("body"), "籍贯");
    if (await field.count() !== 1) { record("籍贯", "missing-field"); return; }
    const parts = [match[1], match[2], match[3]].filter(Boolean);
    try {
      const currentText = await field.innerText();
      if (currentText.includes(parts[parts.length - 1])) { record("籍贯", "already-filled"); return; }
      await field.locator(".phoenix-select").click({ timeout: 5000 });
      let leafOption: Locator | null = null;
      for (const part of parts) {
        const options = page.locator(".area-item-name:visible");
        const resolution = resolveSiteChoice("籍贯", part, await options.allTextContents());
        if (resolution.status !== "matched") { record("籍贯", "unsupported-value", `目标“${part}”；可见地区：${(await options.allTextContents()).slice(0, 25).join("、") || "无"}`); await page.keyboard.press("Escape"); return; }
        const option = options.filter({ hasText: exact(resolution.option) });
        if (await option.count() !== 1) { record("籍贯", "unsupported-value", `地区“${resolution.option}”不唯一`); await page.keyboard.press("Escape"); return; }
        await option.click();
        leafOption = option;
      }
      const leaf = parts[parts.length - 1];
      if (!leafOption || await leafOption.locator(".icon-container.visible").count() !== 1) { record("籍贯", "failed", `未找到“${leaf}”的选择控件`); return; }
      await leafOption.locator(".icon-container.visible").click();
      const confirm = page.getByText("确定", { exact: true }).filter({ visible: true });
      if (await confirm.count() !== 1) { record("籍贯", "failed", `地区已选，找到 ${await confirm.count()} 个可见确认控件`); return; }
      await confirm.click({ timeout: 5000 });
      const selectedText = await field.innerText();
      record("籍贯", selectedText.includes(leaf) ? "filled" : "failed", selectedText.includes(leaf) ? undefined : `页面值：${selectedText.slice(0, 80)}`);
    } catch (error) { record("籍贯", "failed", error instanceof Error ? error.message.slice(0, 180) : String(error)); await page.keyboard.press("Escape").catch(() => {}); }
  };
  const fillPreferredCity = async (value: string) => {
    if (!value.trim()) return;
    const label = "期望工作城市";
    const field = item(page.locator("body"), label);
    if (await field.count() !== 1) { record(label, "missing-field"); return; }
    const match = /^(.*?(?:省|自治区|特别行政区))?(.+?市)$/.exec(value.trim());
    if (!match) { record(label, "unsupported-value", `城市“${value}”需要省、市两级信息`); return; }
    try {
      if ((await field.innerText()).includes(match[2])) { record(label, "already-filled"); return; }
      await field.locator(".phoenix-select").click({ timeout: 5000 });
      const modal = selectorModal();
      const province = match[1] || ({ 深圳市: "广东省", 广州市: "广东省" } as Record<string, string>)[match[2]];
      if (!province) { record(label, "unsupported-value", `缺少“${match[2]}”的省份，需人工核对`); return; }
      const provinceOption = modal.locator(".area-item-name:visible").filter({ hasText: exact(province) });
      await provinceOption.click({ timeout: 3000 });
      const city = modal.locator(".area-item-name:visible").filter({ hasText: exact(match[2]) });
      await city.waitFor({ state: "visible", timeout: 3000 });
      const checkbox = city.locator(".icon-container.visible");
      if (await checkbox.count() !== 1) { record(label, "unsupported-value", `城市“${match[2]}”不可直接勾选`); return; }
      await checkbox.click({ timeout: 3000 });
      if ((await modal.locator(".select-data-num-text").first().innerText()).trim() === "0") { record(label, "failed", "城市未选中"); return; }
      await modal.getByText("确定", { exact: true }).click({ timeout: 3000 });
      record(label, (await field.innerText()).includes(match[2]) ? "filled" : "failed");
    } catch (error) { record(label, "failed", error instanceof Error ? error.message.slice(0, 180) : String(error)); }
    finally { await dismissSelector(); }
  };
  const fillChoice = async (scope: Locator, label: string, value: string) => {
    if (!value.trim()) return;
    const field = item(scope, label);
    if (await field.count() !== 1) { record(label, "missing-field"); return; }
    try {
      const option = field.locator(".phoenix-radio, label").filter({ hasText: exact(value.trim()) });
      if (await option.count() !== 1) { record(label, "unsupported-value"); return; }
      const input = option.locator('input[type="radio"]');
      if (await input.count() && await input.isChecked()) { record(label, "already-filled"); return; }
      await option.click();
      record(label, await input.count() && await input.isChecked() ? "filled" : "failed");
    } catch { record(label, "failed"); }
  };
  const fillExactDate = async (scope: Locator, label: string, value: string) => {
    if (!value.trim()) return;
    const field = item(scope, label);
    if (await field.count() !== 1) { record(label, "missing-field"); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) { record(label, "unsupported-value"); return; }
    const control = field.locator('input[type="date"], input[type="text"]').first();
    const hasEditableControl = await control.count() === 1;
    try {
      const existing = hasEditableControl ? await control.inputValue() : (await field.locator(".phoenix-select").innerText()).trim().replace(/请选择/g, "");
      if (existing === value || existing === value.replace(/-/g, "/")) { record(label, "already-filled"); return; }
      if (existing) { record(label, "preserved-existing"); return; }
      if (hasEditableControl && await control.getAttribute("readonly") === null) {
        await control.fill(value);
        await control.press("Tab");
      } else {
        await field.locator(".phoenix-select").click({ timeout: 5000 });
        const calendarInput = page.locator(".phoenix-calendar-input:visible").last();
        if (await calendarInput.count() !== 1) { record(label, "unsupported-value", "日历输入框未找到"); await page.keyboard.press("Escape"); return; }
        await calendarInput.fill(value);
        await calendarInput.press("Enter");
        if (!(await field.innerText()).includes(value)) {
          const year = Number(value.slice(0, 4));
          const month = Number(value.slice(5, 7));
          const day = Number(value.slice(8, 10));
          let yearSelector = page.locator(".phoenix-calendar-year-select:visible").last();
          if (await yearSelector.count() === 0) {
            await field.locator(".phoenix-select").click({ timeout: 5000 });
            yearSelector = page.locator(".phoenix-calendar-year-select:visible").last();
          }
          if (await yearSelector.count() === 1) {
            await yearSelector.click();
            for (let attempt = 0; attempt < 15; attempt++) {
              const years = (await page.locator(".phoenix-calendar-year-panel-year:visible").allTextContents()).map((text) => Number(text.trim())).filter(Number.isFinite);
              if (years.includes(year)) break;
              if (!years.length) throw new Error("日历年份面板未打开");
              await page.locator(year < Math.min(...years) ? ".phoenix-calendar-year-panel-prev-decade-btn" : ".phoenix-calendar-year-panel-next-decade-btn").last().click();
            }
            await page.locator(".phoenix-calendar-year-panel-year:visible").filter({ hasText: exact(String(year)) }).click();
            await page.locator(".phoenix-calendar-month-panel-month:visible").filter({ hasText: exact(`${month}月`) }).click();
            await page.locator(".phoenix-calendar-cell:not(.phoenix-calendar-prev-month-btn-day):not(.phoenix-calendar-next-month-btn-day) .phoenix-calendar-date:visible").filter({ hasText: exact(String(day)) }).click();
          }
        }
      }
      const selected = hasEditableControl ? await control.inputValue() : await field.innerText();
      record(label, selected.includes(value) || selected.includes(value.replace(/-/g, "/")) ? "filled" : "failed", selected.includes(value) ? undefined : `页面值：${selected.slice(0, 80)}`);
    } catch (error) { record(label, "failed", error instanceof Error ? error.message.slice(0, 180) : String(error)); await page.keyboard.press("Escape").catch(() => {}); }
  };
  const ensureRows = async (anchor: string, addLabel: string, count: number) => {
    for (let existing = await sections(anchor).count(); existing < count; existing++) {
      await page.getByText(addLabel, { exact: true }).click({ timeout: 5000 });
    }
  };

  try {
    if (reviewContext) { await reviewContext.close().catch(() => {}); reviewContext = null; }
    context = await launchReviewBrowser(resolve("data/private/browser-profile"), {
      channel: "chrome", headless: false, acceptDownloads: false,
    });
    reviewContext = context;
    page = context.pages()[0] || await context.newPage();
    await input.onProgress("exploring", "正在打开国科微申请表。若出现登录页，请在打开的 Chrome 窗口自行登录。");
    await page.goto(url.toString(), { waitUntil: "domcontentloaded", timeout: 30000 });
    let ready = false;
    for (let i = 0; i < 60; i++) {
      if (new URL(page.url()).pathname === "/form" && await page.getByText("预览并提交", { exact: true }).count() > 0) {
        ready = true; break;
      }
      await page.waitForTimeout(5000);
    }
    if (!ready) throw new Error("5 分钟内未检测到已登录的国科微申请表。");
    await input.onProgress("prefilling", "已登录；正在填写已确认的档案字段、日期和经历。");
    await fillText(page.locator("body"), "姓名", profile.candidate.fullName);
    await fillText(page.locator("body"), "邮箱", profile.candidate.email);
    await fillText(page.locator("body"), "手机号", profile.candidate.phone.replace(/\D/g, ""));
    const table = profile.resumeTable || {};
    const preference = table.jobPreferences?.find((row) => row.some(Boolean));
    const details = profile.applicationDetails;
    if (details) {
      await fillChoice(page.locator("body"), "性别", details.gender);
      await fillHometown(details.hometown);
      await fillExactDate(page.locator("body"), "出生日期", details.birthDate);
      await fillSelect(page.locator("body"), "工作年限", details.workYears, "");
      if (!preference?.[4]) await fillSelect(page.locator("body"), "期望从事行业", details.desiredIndustry, "");
      if (!preference?.[5]) await fillSelect(page.locator("body"), "期望从事职业", details.desiredOccupation, "");
      if (!preference?.[6]) await fillPreferredCity(profile.preferences.locationPreference);
      if (!preference?.[7]) await fillSelect(page.locator("body"), "期望月薪(税前)", details.desiredMonthlySalary, "");
    }
    if (preference) {
      const mappings: Array<[string, string]> = [["现从事行业", preference[0]], ["现从事职业", preference[1]], ["现工作城市", preference[2]], ["现月薪(税前)", preference[3]], ["期望从事行业", preference[4]], ["期望从事职业", preference[5]], ["期望工作城市", preference[6]], ["期望月薪(税前)", preference[7]], ["到岗时间", preference[8]]];
      const noCurrentJob = [preference[0], preference[1], preference[3]].every((value) => !value || value === "无");
      for (const [label, value] of mappings) {
        if (noCurrentJob && label.startsWith("现")) { record(label, "not-applicable", "档案标记无当前工作"); continue; }
        if (!value) continue;
        if (label === "期望工作城市") await fillPreferredCity(value);
        else await fillSelect(page.locator("body"), label, value, "");
      }
    }
    const languages = (table.languageAbility || []).filter((row) => row.some(Boolean));
    await ensureRows("语言类型", "添加语言能力", languages.length);
    for (let index = 0; index < languages.length; index++) {
      const scope = sections("语言类型").nth(index);
      const row = languages[index];
      for (const [column, label] of ["语言类型", "掌握程度", "听说", "读写"].entries()) {
        if (row[column]) await fillSelect(scope, label, row[column], `语言能力${index + 1}：`);
      }
    }
    const education = (table.education || []).filter((row) => row.some(Boolean));
    const employment = (table.employment || []).filter((row) => row.some(Boolean));
    const projects = (table.projects || []).filter((row) => row.some(Boolean));
    await ensureRows("学校名称", "添加教育经历", education.length);
    for (let index = 0; index < education.length; index++) {
      const row = education[index]; const scope = sections("学校名称").nth(index); const prefix = `教育经历${index + 1}：`;
      await fillText(scope, "学校名称", row[0], prefix);
      await fillMonth(scope, "开始时间", row[3], prefix);
      await fillMonth(scope, "结束时间", row[4], prefix);
      await fillText(scope, "专业名称", row[2], prefix);
      const degree = row[1].trim();
      const level = /硕士/.test(degree) ? "硕士研究生" : /博士/.test(degree) ? "博士研究生" : /学士|本科/.test(degree) ? "本科" : "";
      const award = /博士/.test(degree) ? "博士" : /硕士/.test(degree) ? "硕士" : /学士/.test(degree) ? "学士" : "";
      await fillSelect(scope, "学历", level, prefix);
      await fillSelect(scope, "学位", award, prefix);
    }
    await ensureRows("单位名称", "添加工作经历", employment.length);
    for (let index = 0; index < employment.length; index++) {
      const row = employment[index]; const scope = sections("单位名称").nth(index); const prefix = `工作经历${index + 1}：`;
      await fillText(scope, "单位名称", row[0], prefix);
      await fillText(scope, "职位名称", row[1], prefix);
      await fillText(scope, "工作职责", row[4], prefix);
      if (row[2]) record(`${prefix}开始时间`, "not-on-form");
      if (row[3]) record(`${prefix}结束时间`, "not-on-form");
    }
    await ensureRows("项目名称", "添加项目经历", projects.length);
    for (let index = 0; index < projects.length; index++) {
      const row = projects[index]; const scope = sections("项目名称").nth(index); const prefix = `项目经历${index + 1}：`;
      await fillText(scope, "项目名称", row[0], prefix);
      await fillMonth(scope, "开始时间", row[2], prefix);
      await fillMonth(scope, "结束时间", row[3], prefix);
      await fillText(scope, "项目描述", row[4], prefix);
      await fillText(scope, "项目中职责", row[1], prefix);
    }
    let resumeUpload = "未上传：本次未单独选择岗位匹配简历";
    if (input.uploadSelectedResume) {
      try {
        const upload = page.locator('input[type="file"]').first();
        if (await upload.count() === 1) {
          await upload.setInputFiles(input.resumePath);
          resumeUpload = "已上传本次选择的简历";
        } else resumeUpload = "未找到简历上传入口";
      } catch { resumeUpload = "简历上传失败，需人工处理"; }
    }
    // A final observation pass retries known controls only when the page still shows a blank value.
    // It keeps the same browser session and never touches save or submit controls.
    if (details) {
      await input.onProgress("prefilling", "正在复查籍贯、出生日期和工作年限等空白控件，并验证补填结果。");
      const blank = async (label: string) => {
        const field = item(page.locator("body"), label);
        return await field.count() === 1 && await field.locator(".phoenix-select__placeHolder--show").count() > 0;
      };
      const retries: Array<[string, string, () => Promise<void>]> = [
        ["籍贯", details.hometown, () => fillHometown(details.hometown)],
        ["出生日期", details.birthDate, () => fillExactDate(page.locator("body"), "出生日期", details.birthDate)],
        ["工作年限", details.workYears, () => fillSelect(page.locator("body"), "工作年限", details.workYears, "")],
      ];
      for (const [label, value, retry] of retries) {
        if (value && await blank(label) && results.find((result) => result.label === label)?.status !== "filled") await retry();
      }
    }
    const requiredOnPage = await page.evaluate(() => {
      const sectionNames = ["推荐码", "基本信息", "求职意向", "教育经历", "工作经历", "项目经历", "语言能力", "附件"];
      const sections = Array.from(document.querySelectorAll(".form-part"));
      return Array.from(document.querySelectorAll(".form-item"))
        .filter((field) => field.querySelector('.form-item__required, [aria-required="true"]'))
        .map((field) => ({
          section: sectionNames[sections.indexOf(field.closest(".form-part") as Element)] || "其他",
          label: (field.querySelector("label.form-item__text, label")?.textContent || "").trim().replace(/\s+/g, " "),
        })).filter((field) => field.label);
    });
    const unprocessedRequired = requiredOnPage.filter(({ section, label }) => {
      if (["教育经历", "工作经历", "项目经历"].includes(section)) return !results.some((result) => result.label.startsWith(section) && result.label.endsWith(`：${label}`));
      return !results.some((result) => result.label === label);
    }).map(({ section, label }) => `${section}：${label}（必填，待人工核对）`);
    const missingSource = [
      ...(["性别", "籍贯", "出生日期", "工作年限"] as const).filter((label) => {
        const key = ({ 性别: "gender", 籍贯: "hometown", 出生日期: "birthDate", 工作年限: "workYears" } as const)[label];
        return !details?.[key];
      }).map((label) => `基本信息：${label}（档案未提供）`),
      ...(["现从事行业", "现从事职业", "现工作城市", "现月薪(税前)", "期望从事行业", "期望从事职业", "期望工作城市", "期望月薪(税前)", "到岗时间"] as const)
        .filter((label, index) => !preference?.[index] && !(index === 4 && details?.desiredIndustry) && !(index === 5 && details?.desiredOccupation) && !(index === 6 && profile.preferences.locationPreference) && !(index === 7 && details?.desiredMonthlySalary))
        .map((label) => `求职意向：${label}（档案未提供）`),
      ...(["语言类型", "掌握程度", "听说", "读写"] as const).filter((_, index) => !languages[0]?.[index]).map((label) => `语言能力：${label}（档案未提供）`),
    ];
    const unresolved = [
      ...(education.length ? [] : ["教育经历：档案表格未提供"]),
      ...(employment.length ? [] : ["工作经历：档案表格未提供"]),
      ...(projects.length ? [] : ["项目经历：档案表格未提供"]),
      ...results.filter((item) => !["filled", "already-filled", "not-applicable"].includes(item.status)).map((item) => `${item.label}：${item.status}${item.detail ? `（${item.detail}）` : ""}`),
      ...new Set(unprocessedRequired),
      ...missingSource,
    ];
    const result: BeisenProfileResult = {
      status: "review",
      job: { url: url.toString(), company: "国科微", title: "校园招聘申请" },
      resume: { email: profile.candidate.email },
      evaluation: { score: 0, recommendation: "not-evaluated", fitAnalysis: "北森表单填写试点；职位匹配度尚未评测。", matchStrengths: [], matchGaps: [] },
      draftedAnswers: [],
      filled: results.filter((item) => item.status === "filled").length,
      skipped: unresolved.length,
      failed: results.filter((item) => item.status === "failed").length,
      beisen: { results, unresolved, resumeUpload },
    };
    await input.onProgress("review", `已填写 ${result.filled} 项；还有 ${unresolved.length} 项需要核对。浏览器停在提交前，未暂存或投递。`);
    return result;
  } catch (error) {
    await context?.close().catch(() => {});
    if (reviewContext === context) reviewContext = null;
    throw error;
  } finally {
    active = false;
  }
}
