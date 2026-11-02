import * as cheerio from "cheerio";
import { NextRequest, NextResponse } from "next/server";
import { checkLocalRequest } from "../../../intake/local-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    checkLocalRequest(request);
    const url = new URL(request.nextUrl.searchParams.get("url") || "");
    const smic = url.hostname === "smics.zhiye.com" && url.pathname === "/campusxq" && /^\d+$/.test(url.searchParams.get("jobId") || "");
    const stongyw = url.hostname === "iter.stongyw.cn" && url.pathname === "/web/school/job/position_details.html" && /^[0-9a-f-]{36}$/i.test(url.searchParams.get("pid") || "");
    if (url.protocol !== "https:" || (!smic && !stongyw)) throw new Error("请提供受支持的具体职位详情链接。");
    const response = await fetch(url, { signal: AbortSignal.timeout(15000), cache: "no-store" });
    if (!response.ok) throw new Error(`职位页面暂时无法读取（${response.status}）。`);
    const $ = cheerio.load(await response.text());
    if (stongyw) {
      const title = $(".text-main.text-middle").first().text().trim();
      const company = $(".text-main.text-middle").first().next(".text-gray").text().trim();
      const details = $(".job-area").parent().parent().find(".x6").map((_, el) => $(el).text().replace(/\s+/g, " ").trim()).get();
      const content = $(".clearfix.padding-big").filter((_, el) => $(el).text().includes("【岗位职责】")).first().text().replace(/\s+/g, " ").trim();
      if (!title || !company || !content) throw new Error("未识别到完整的职位信息，请检查职位是否仍有效。");
      const requirementsAt = content.indexOf("【应聘资格条件】");
      return NextResponse.json({ url: url.toString(), title, company, details, description: content.slice(0, requirementsAt > 0 ? requirementsAt : undefined), requirements: requirementsAt > 0 ? content.slice(requirementsAt) : "", applicationState: "login_required", notice: "申请按钮会先进入登录页。本站表单适配尚未完成；请本人登录后提供申请表信息，Job Agent 不会代你点击最终投递。" });
    }
    const title = $(".xqtitle h2").first().text().replace(/\s+/g, " ").trim();
    const details = $(".xqbox li").map((_, el) => $(el).text().replace(/\s+/g, " ").trim()).get();
    const sections = $(".xqbox .xqm").map((_, el) => $(el).text().replace(/\s+/g, " ").trim()).get();
    if (!title || sections.length < 2) throw new Error("未识别到完整的职位信息。");
    return NextResponse.json({
      url: url.toString(), title, company: "中芯国际",
      details, description: sections[0], requirements: sections[1],
      applicationState: "consent_required",
      notice: "申请前需由本人阅读并同意网站知情同意书，然后登录。Job Agent 不会代替你接受承诺或提交申请。",
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "无法读取职位。" }, { status: 400 });
  }
}
