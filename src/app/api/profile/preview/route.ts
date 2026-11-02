import { NextRequest, NextResponse } from "next/server";
import { checkLocalRequest } from "../../../../intake/local-store";
import { readResume } from "../../../../intake/parse-resume";

export const runtime = "nodejs";

function dates(value: string): [string, string] {
  const matches = value.match(/(?:19|20)\d{2}(?:[-./年]\d{1,2})?/g) || [];
  return [matches[0] || "", matches[1] || ""];
}

export async function POST(request: NextRequest) {
  try {
    checkLocalRequest(request);
    const form = await request.formData();
    const resume = form.get("resume");
    if (!(resume instanceof File)) throw new Error("请先选择图片、TXT、PDF 或 Word 简历。");
    const parsed = await readResume(resume);
    const resumeTable = {
      education: parsed.education.map((item) => [item.school, item.degree, item.details || "", ...dates(item.year), ""]),
      employment: parsed.experience.map((item) => [item.company, item.title, ...dates(item.duration), item.description]),
    };
    return NextResponse.json({
      candidate: { fullName: parsed.name === "Unknown" ? "" : parsed.name, email: parsed.email, phone: parsed.phone },
      resumeTable,
      facts: { education: parsed.education.length, experience: parsed.experience.length, skills: parsed.skills.length },
      warning: "Check every extracted field before saving. Supporting files are stored as evidence, not treated as verified facts automatically.",
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Preview failed." }, { status: 400 });
  }
}
