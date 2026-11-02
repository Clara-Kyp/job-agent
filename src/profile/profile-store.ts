import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { CandidateProfile, ResumeData } from "../types/index.js";

export const DEFAULT_PROFILE_PATH = resolve(process.cwd(), "data/profile.json");

export function profileFromResume(resume: ResumeData, resumePath: string): CandidateProfile {
  const experienceFacts = resume.experience.flatMap((item) => [
    [item.title, item.company, item.duration].filter(Boolean).join(" | "),
    item.description,
  ]).filter(Boolean);
  const educationFacts = resume.education.map((item) =>
    [item.degree, item.school, item.year, item.details].filter(Boolean).join(" | "),
  );

  return {
    version: 1,
    resumePath: resolve(resumePath),
    candidate: {
      fullName: resume.name === "Unknown" ? "" : resume.name,
      email: resume.email,
      phone: resume.phone,
      linkedin: resume.linkedin,
      github: resume.github,
      portfolio: "",
      city: "",
      country: "",
    },
    workAuthorization: {
      authorizedCountries: [],
      requiresSponsorship: null,
      visaStatus: "",
    },
    preferences: {
      desiredSalary: "",
      earliestStartDate: "",
      noticePeriod: "",
      locationPreference: "",
      willingToRelocate: null,
    },
    answerStyle: {
      tone: "concise, direct, and natural",
      maxSentences: 4,
      phrasesToAvoid: ["I am thrilled", "perfect fit", "leverage my skills"],
    },
    commonAnswers: {},
    facts: [resume.summary, ...resume.skills.map((skill) => `Skill: ${skill}`), ...experienceFacts, ...educationFacts]
      .map((item) => item.trim())
      .filter(Boolean),
    updatedAt: new Date().toISOString(),
  };
}

export function loadProfile(profilePath = DEFAULT_PROFILE_PATH): CandidateProfile | null {
  if (!existsSync(profilePath)) return null;
  const parsed = JSON.parse(readFileSync(profilePath, "utf8")) as CandidateProfile;
  if (parsed.version !== 1) throw new Error(`Unsupported profile version: ${String(parsed.version)}`);
  return parsed;
}

export function saveProfile(profile: CandidateProfile, profilePath = DEFAULT_PROFILE_PATH): void {
  mkdirSync(dirname(profilePath), { recursive: true });
  profile.updatedAt = new Date().toISOString();
  writeFileSync(profilePath, `${JSON.stringify(profile, null, 2)}\n`, { mode: 0o600 });
}

export function addSupplement(profile: CandidateProfile, text: string): CandidateProfile {
  const facts = text
    .split(/\r?\n/)
    .map((line) => line.replace(/^[\s•*-]+/, "").trim())
    .filter((line) => line.length > 2);
  profile.facts = [...new Set([...profile.facts, ...facts])];
  return profile;
}

export function redactProfile(profile: CandidateProfile): CandidateProfile {
  return {
    ...profile,
    candidate: {
      ...profile.candidate,
      email: profile.candidate.email ? "***" : "",
      phone: profile.candidate.phone ? "***" : "",
    },
  };
}
