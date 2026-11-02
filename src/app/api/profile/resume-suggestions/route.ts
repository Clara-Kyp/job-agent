import { existsSync, readFileSync } from "node:fs";
import { basename, extname } from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { checkLocalRequest } from "../../../../intake/local-store";
import { readResume } from "../../../../intake/parse-resume";
import { loadProfile } from "../../../../profile/profile-store";
import type { ResumeTable } from "../../../../intake/structured-profile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function months(value: string): string[] {
  return [...value.matchAll(/(?:19|20)\d{2}\s*[-./年]\s*(?:0?[1-9]|1[0-2])(?:月)?/g)]
    .map(([match]) => {
      const parts = match.match(/((?:19|20)\d{2})\s*[-./年]\s*(\d{1,2})/);
      return parts ? `${parts[1]}-${parts[2].padStart(2, "0")}` : "";
    }).filter(Boolean);
}

export async function GET(request: NextRequest) {
  try {
    checkLocalRequest(request);
    const profile = loadProfile();
    if (!profile || !existsSync(profile.resumePath)) throw new Error("请先保存简历档案。");
    const name = basename(profile.resumePath);
    const extension = extname(name).toLowerCase();
    const type = extension === ".pdf" ? "application/pdf" : extension === ".txt" ? "text/plain" : extension === ".docx" ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document" : extension === ".png" ? "image/png" : extension === ".jpg" || extension === ".jpeg" ? "image/jpeg" : "application/msword";
    const resume = await readResume(new File([readFileSync(profile.resumePath)], name, { type }));
    const suggested: ResumeTable = {
      education: resume.education.map((item) => {
        const dates = months(item.year);
        return [item.school, item.degree, item.details || "", dates[0] || "", dates[1] || "", ""];
      }),
      employment: resume.experience.map((item) => {
        const dates = months(item.duration);
        return [item.company, item.title, dates[0] || "", dates[1] || "", item.description];
      }),
    };
    return NextResponse.json({ resumeName: name, suggestions: suggested, warning: "这是简历文字解析建议，需逐项核对学校、单位和日期后保存。" });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "无法读取已保存简历。" }, { status: 400 });
  }
}
