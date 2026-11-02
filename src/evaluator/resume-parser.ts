import { readFileSync } from "fs";
import type { ResumeData, Experience, Education } from "../types/index.js";

/**
 * Parse a plain-text resume into structured data.
 * Expects a reasonably formatted resume with sections.
 */
export function parseResume(filePath: string): ResumeData {
  console.log(`  📄 Parsing resume: ${filePath}`);
  return parseResumeText(readFileSync(filePath, "utf-8"));
}

/** Parse text extracted from a PDF or read from a TXT resume. */
export function parseResumeText(rawText: string): ResumeData {
  const lines = rawText.split("\n").map((l) => l.trim());

  // Extract email
  const emailMatch = rawText.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
  const email = emailMatch ? emailMatch[0] : "";

  // Extract phone
  const phoneMatch = rawText.match(/(?:\+?86[\s-]*)?1[3-9]\d[\s-]*\d{4}[\s-]*\d{4}/)
    || rawText.match(/[\+]?[(]?\d{3}[)]?[-\s.]?\d{3}[-\s.]?\d{4}/);
  const phone = phoneMatch ? phoneMatch[0] : "";

  // Extract LinkedIn
  const linkedinMatch = rawText.match(/linkedin\.com\/in\/[\w-]+/i);
  const linkedin = linkedinMatch ? linkedinMatch[0] : "";

  // Extract GitHub
  const githubMatch = rawText.match(/github\.com\/[\w-]+/i);
  const github = githubMatch ? githubMatch[0] : "";

  // The first non-empty line is usually the name
  const firstLine = lines.find((l) => l.length > 2 && !l.includes("@") && !l.includes("http")) || "Unknown";
  const name = (/求职简历/.test(firstLine) ? firstLine.split(/\s+/)[0] : firstLine.split(/\s*[|｜]\s*/)[0]).trim();

  // Extract sections by detecting headers
  const sections = splitIntoSections(lines);

  const skills = extractSkills([
    ...(sections.skills || []),
    ...(sections["technical skills"] || []),
    ...(sections.technologies || []),
  ]);
  const experience = extractExperience([
    ...(sections.experience || []),
    ...(sections["work experience"] || []),
    ...(sections.employment || []),
    ...(sections["experience & leadership"] || []),
  ]);
  const education = extractEducation(sections.education || []);
  const summary =
    sections.summary?.join(" ") ||
    sections.objective?.join(" ") ||
    sections.profile?.join(" ") ||
    "";

  const resume: ResumeData = {
    name,
    email,
    phone,
    linkedin,
    github,
    summary,
    skills,
    experience,
    education,
    rawText,
  };


  return resume;
}

/**
 * Split resume lines into named sections.
 */
function splitIntoSections(lines: string[]): Record<string, string[]> {
  const sections: Record<string, string[]> = {};
  let currentSection = "header";
  sections[currentSection] = [];

  const sectionHeaders = [
    "summary",
    "objective",
    "profile",
    "about",
    "experience",
    "work experience",
    "employment",
    "education",
    "skills",
    "technical skills",
    "technologies",
    "projects",
    "certifications",
    "awards",
    "publications",
    "languages",
    "interests",
    "references",
    "experience & leadership",
    "technical projects",
  ];

  for (const line of lines) {
    const lower = line.toLowerCase().replace(/[:\s]+$/, "").trim();

    // Check if this line is a section header
    const isHeader = sectionHeaders.includes(lower) || lower in chineseHeaders;
    // CJK text has no case: line === line.toUpperCase() is true for ordinary
    // Chinese resume content and must not split its experience/skills sections.
    const looksLikeHeader = /^[A-Z][A-Z\s&/]{2,39}$/.test(line);

    if (isHeader || looksLikeHeader) {
      currentSection = normalizeSectionName(lower);
      sections[currentSection] = [];
    } else if (line.length > 0) {
      sections[currentSection].push(line);
    }
  }

  return sections;
}

function normalizeSectionName(section: string): string {
  const normalized = section.replace(/[:]+$/, "").trim();
  if (normalized in chineseHeaders) return chineseHeaders[normalized];
  if (normalized === "technical projects") return "projects";
  if (normalized === "experience & leadership") return "experience & leadership";
  if (normalized === "technical skills" || normalized === "technologies") return "technical skills";
  return normalized;
}

const chineseHeaders: Record<string, string> = {
  "职业概述": "summary",
  "教育背景": "education",
  "教育经历": "education",
  "工作与实习经历": "experience",
  "工作经历": "experience",
  "工作/实习经历": "experience",
  "实习经历": "experience",
  "专业技能": "skills",
  "荣誉奖项": "awards",
  "奖项/论文": "awards",
  "项目经历": "projects",
  "语言/资格": "certifications",
  "语言与资格": "certifications",
  "论文与会议": "publications",
  "专利": "patents",
  "标准": "standards",
  "证书": "certifications",
};

/**
 * Extract skills from the skills section lines.
 */
function extractSkills(lines: string[]): string[] {
  const skills: string[] = [];

  for (const line of lines) {
    // Split by common delimiters
    const parts = line.split(/[,;|•\/、，；：:]/).map((s) => s.trim()).filter(Boolean);
    for (const part of parts) {
      if (part.length > 1 && part.length < 100) {
        skills.push(part);
      }
    }
  }

  return [...new Set(skills)];
}

function dateRangeFromLine(line: string): string {
  const dates = [...line.matchAll(/(?:19|20)\d{2}\s*[-./年]\s*(?:0?[1-9]|1[0-2])(?:月)?/g)].map(([value]) => value);
  return dates.length ? dates.slice(0, 2).join(" - ") : "";
}

/**
 * Extract work experience from lines.
 */
function extractExperience(lines: string[]): Experience[] {
  const experiences: Experience[] = [];
  let current: Partial<Experience> | null = null;

  for (const line of lines) {
    const pipeParts = line.split(/\s*[|｜]\s*/).map((part) => part.trim());
    if (pipeParts.length >= 3 && /\d{4}/.test(pipeParts.slice(2).join(" "))) {
      if (current && current.title) experiences.push(current as Experience);
      const companyFirst = /公司|集团|科技|设计|实验室|咨询|传媒|网络|软件|数据|产品/.test(pipeParts[0]);
      current = {
        title: companyFirst ? pipeParts[1] : pipeParts[0],
        company: companyFirst ? pipeParts[0] : pipeParts[1],
        duration: pipeParts.slice(2).join(" | "),
        description: "",
      };
      continue;
    }
    // Lines with dates often indicate a new experience entry
    const hasDate =
      /\b(20\d{2}|19\d{2})\b/.test(line) ||
      /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\b/i.test(line);

    // Lines with "at" or comma-separated company info
    const hasCompanyIndicator = /\bat\b|\bfor\b/.test(line.toLowerCase()) || line.includes(",");

    if (hasDate || (hasCompanyIndicator && line.length < 80)) {
      if (current && current.title) {
        experiences.push(current as Experience);
      }

      // Try to parse title and company
      const parts = line.split(/[-–—|,]/).map((s) => s.trim());
      current = {
        title: parts[0] || "",
        company: parts[1] || "",
        duration: dateRangeFromLine(line) || parts.find((p) => /\d{4}/.test(p)) || "",
        description: "",
      };
    } else if (current) {
      // Accumulate description lines
      const cleaned = line.replace(/^[•\-\*]\s*/, "").trim();
      if (cleaned.length > 5) {
        current.description = (current.description ? current.description + " " : "") + cleaned;
      }
    }
  }

  if (current && current.title) {
    experiences.push(current as Experience);
  }

  return experiences;
}

/**
 * Extract education from lines.
 */
function extractEducation(lines: string[]): Education[] {
  const educations: Education[] = [];
  let current: Partial<Education> | null = null;

  for (const line of lines) {
    const pipeParts = line.split(/\s*[|｜]\s*/).map((part) => part.trim());
    if (pipeParts.length >= 3 && /大学|学院/.test(pipeParts[0]) && /\d{4}/.test(pipeParts.at(-1) || "")) {
      if (current && current.degree) educations.push(current as Education);
      current = {
        school: pipeParts[0],
        degree: pipeParts.length >= 4 ? pipeParts[2] : pipeParts[1],
        details: pipeParts.length >= 4 ? pipeParts[1] : "",
        year: pipeParts.at(-1) || "",
      };
      continue;
    }
    const hasYear = /\b(20\d{2}|19\d{2})\b/.test(line);
    const hasDegree = /\b(b\.?s\.?|bachelor|m\.?s\.?|master|ph\.?d|diploma|degree|associate)/i.test(line);

    if (hasDegree || hasYear) {
      if (current && current.degree) {
        educations.push(current as Education);
      }

      const parts = line.split(/[-–—|,]/).map((s) => s.trim());
      const schoolFirst = /大学|学院/.test(parts[0] || "") && /本科|硕士|博士|学位/.test(parts[1] || "");
      current = {
        degree: (schoolFirst ? parts[1] : parts[0]) || "",
        school: (schoolFirst ? parts[0] : parts[1]) || "",
        year: dateRangeFromLine(line) || parts.find((p) => /\d{4}/.test(p)) || "",
      };
    } else if (current && !current.school) {
      current.school = line.trim();
    }
  }

  if (current && current.degree) {
    educations.push(current as Education);
  }

  return educations;
}

/**
 * Build a compact resume summary for LLM prompts.
 */
export function resumeToPromptSummary(resume: ResumeData): string {
  const parts: string[] = [];

  parts.push(`Name: ${resume.name}`);
  parts.push(`Skills: ${resume.skills.join(", ")}`);

  if (resume.experience.length > 0) {
    parts.push("\nExperience:");
    for (const exp of resume.experience.slice(0, 5)) {
      parts.push(`  - ${exp.title}${exp.company ? ` at ${exp.company}` : ""} (${exp.duration})`);
      if (exp.description) {
        parts.push(`    ${exp.description.slice(0, 200)}`);
      }
    }
  }

  if (resume.education.length > 0) {
    parts.push("\nEducation:");
    for (const edu of resume.education) {
      parts.push(`  - ${edu.degree}${edu.school ? ` at ${edu.school}` : ""} (${edu.year})`);
    }
  }

  if (resume.summary) {
    parts.push(`\nSummary: ${resume.summary.slice(0, 300)}`);
  }

  return parts.join("\n");
}
