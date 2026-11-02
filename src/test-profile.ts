import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { profileFromResume } from "./profile/profile-store.js";
import { resolveProfileField, unresolvedStandardFields } from "./profile/field-resolver.js";
import { parseResume } from "./evaluator/resume-parser.js";
import type { FormField, ResumeData } from "./types/index.js";

const resume: ResumeData = {
  name: "Ada Lovelace",
  email: "ada@example.com",
  phone: "+1 555 123 4567",
  linkedin: "linkedin.com/in/ada",
  github: "github.com/ada",
  summary: "Product engineer focused on reliable systems.",
  skills: ["TypeScript"],
  experience: [],
  education: [],
  rawText: "",
};

const profile = profileFromResume(resume, "resume.txt");
assert.equal(resolveProfileField("First name", profile).value, "Ada");
assert.equal(resolveProfileField("Email address", profile).value, "ada@example.com");
assert.equal(resolveProfileField("Will you need sponsorship?", profile).value, "");
assert.equal(resolveProfileField("Gender", profile).sensitive, true);

const fields: FormField[] = [
  {
    label: "Email address",
    type: "email",
    required: true,
    selector: "#email",
    semanticLocator: "getByLabel(\"Email address\")",
    isCustomQuestion: false,
  },
  {
    label: "Desired salary",
    type: "text",
    required: true,
    selector: "#salary",
    semanticLocator: "getByLabel(\"Desired salary\")",
    isCustomQuestion: false,
  },
];

assert.deepEqual(unresolvedStandardFields(fields, profile), [
  { label: "Desired salary", required: true, reason: "sensitive_field" },
]);

const testDir = mkdtempSync(join(tmpdir(), "applyflow-cn-resume-"));
try {
  const testResume = join(testDir, "resume.txt");
  writeFileSync(testResume, [
    "测试姓名", "+86 138-0000-0000", "SUMMARY", "产品经理。",
    "EDUCATION", "示例大学 | 数据科学硕士 | 2026–2027", "另一大学 | 建筑学本科 | 2020",
    "EXPERIENCE", "产品经理 - 甲公司 - 2023–2026", "负责客户需求分析。",
    "产品实习生 - 乙公司 - 2022", "设计原型并跟进上线。",
    "SKILLS", "产品与数据：Python、SQL；需求分析、PRD",
  ].join("\n"));
  const parsed = parseResume(testResume);
  assert.equal(parsed.phone, "+86 138-0000-0000");
  assert.equal(parsed.experience.length, 2);
  assert.equal(parsed.education.length, 2);
  assert.equal(parsed.education[0].school, "示例大学");
  assert.ok(parsed.skills.includes("Python"));
} finally {
  rmSync(testDir, { recursive: true, force: true });
}
console.log("Profile resolution checks passed.");
