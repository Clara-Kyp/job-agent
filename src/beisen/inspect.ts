/** Read-only pilot for a Beisen job form in Job Agent's dedicated browser. */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { WebcmdSession } from "../filler/webcmd-session.js";
import { parseBeisenForm } from "./form-parser.js";

const rawUrl = process.argv[2];
if (!rawUrl) throw new Error("Usage: npm run beisen:inspect -- '<Beisen form URL>'");
const url = new URL(rawUrl);
if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Expected an HTTP(S) URL.");
if (url.hostname !== "goke.zhiye.com" || url.pathname !== "/form" ||
    !/^[0-9a-f-]{36}$/i.test(url.searchParams.get("jobAdId") || "")) {
  throw new Error("This pilot accepts only a Guoke Beisen job form URL with a jobAdId.");
}
url.protocol = "https:";

const browser = new WebcmdSession(undefined, "job-agent-beisen", true);
try {
  await browser.launch();
  await browser.navigate(url.toString());
  console.log("请在 Job Agent 新打开的 Chrome 窗口中自行完成登录及条款确认；本命令只读取字段结构。等待最多 5 分钟。\n");

  let ready = false;
  for (let i = 0; i < 60; i++) {
    const probe = await browser.runProgram(`return { url: page.url(), ready: await page.getByText('预览并提交', { exact: true }).count() > 0 && await page.getByText('教育经历', { exact: false }).count() > 0 };`);
    const state = probe.result as { url?: string; ready?: boolean };
    if (state.url && new URL(state.url).pathname === "/form" && state.ready) {
      ready = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
  if (!ready) throw new Error("5 分钟内未检测到已登录的申请表。请重新运行命令。 ");

  const analysis = await parseBeisenForm(browser);
  const safeToMap = analysis.sectionCount === 8 && analysis.fields.length >= 30 &&
    analysis.fields.every((field) => field.sectionIndex >= 0 && field.label.length > 0);
  const target = resolve(process.cwd(), "output/goke-beisen-field-map.json");
  mkdirSync(resolve(process.cwd(), "output"), { recursive: true });
  // Field metadata only. Do not save entered values, account IDs or the URL query.
  writeFileSync(target, JSON.stringify({
    host: url.hostname,
    path: url.pathname,
    capturedAt: new Date().toISOString(),
    status: safeToMap ? "field-map-review-required" : "unsupported-field-map",
    identifiedFieldCount: analysis.fields.length,
    totalFieldCount: analysis.fields.length,
    sections: analysis.sectionCount,
    fields: analysis.fields,
    uploads: analysis.uploads,
    hasResumeUpload: analysis.uploads.some((upload) => upload.kind === "resume"),
  }, null, 2));
  console.log(`已保存只读字段清单：${target}`);
  console.log(`识别 ${analysis.sectionCount} 个分区、${analysis.fields.length} 个字段。`);
  if (!safeToMap) console.warn("北森字段标签识别不足，禁止自动填写。 ");
} finally {
  await browser.close();
}
