import { strict as assert } from "node:assert";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest } from "next/server";

const originalCwd = process.cwd();
const testRoot = mkdtempSync(join(tmpdir(), "job-agent-profile-edit-"));

try {
  process.chdir(testRoot);
  mkdirSync("data/private/intake", { recursive: true });
  const resumePath = join(testRoot, "resume.txt");
  writeFileSync(resumePath, "Example Candidate\nexample@example.com\nEducation\nExample University | Bachelor | 2020.09 - 2024.06\n");
  const documentPath = join(testRoot, "proof.txt");
  writeFileSync(documentPath, "Example proof");
  const manifest = {
    version: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    resumePath,
    documents: [{ category: "education", originalName: "proof.txt", storedPath: documentPath, bytes: 13,
      details: { title: "Example proof", issuedAt: "2024-06", issuer: "Example University", scoreOrResult: "", expiresAt: "", notes: "" } }],
  };
  const manifestPath = join(testRoot, "data/private/intake/current.json");
  writeFileSync(manifestPath, JSON.stringify(manifest));
  const { profileFromResume, saveProfile, loadProfile } = await import("./profile/profile-store.js");
  const profile = profileFromResume({ name: "Example Candidate", email: "example@example.com", phone: "", linkedin: "", github: "", summary: "", skills: [], experience: [], education: [], rawText: "" }, resumePath);
  profile.facts.push("Original verified fact");
  profile.resumeTable = { education: [["Outdated School", "Bachelor", "", "2010-09", "2014-06", ""]] };
  profile.facts.push("教育经历: 学校 Outdated School；学历 / 学位 Bachelor；开始时间 2010-09；结束时间 2014-06");
  saveProfile(profile);

  const { POST } = await import("./app/api/profile/route.js");
  const body = new FormData();
  body.set("confirmed", JSON.stringify({ fullName: "Example Candidate", email: "example@example.com", phone: "", city: "", country: "", desiredSalary: "", earliestStartDate: "", locationPreference: "", visaStatus: "", sponsorship: "unknown" }));
  body.set("resumeTable", JSON.stringify({ education: [["Example University", "Bachelor", "", "2020-09", "2024-06", ""]] }));
  body.set("documentDetails", "[]");
  const response = await POST(new NextRequest("http://127.0.0.1:3100/api/profile", { method: "POST", body }));
  const result = await response.json();
  assert.equal(response.status, 200, JSON.stringify(result));
  assert.equal(result.documentCount, 1);
  assert.deepEqual(JSON.parse(readFileSync(manifestPath, "utf8")), manifest);
  assert.equal(loadProfile()?.resumePath, resumePath);
  assert.ok(loadProfile()?.facts.includes("Original verified fact"));
  assert.ok(!loadProfile()?.facts.some((fact) => fact.includes("Outdated School")));
  assert.equal(loadProfile()?.resumeTable?.education?.length, 1);
  console.log("Profile edit retained the original resume, evidence manifest, and verified facts.");
} finally {
  process.chdir(originalCwd);
  rmSync(testRoot, { recursive: true, force: true });
}
