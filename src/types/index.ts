// ─── Job Posting ───────────────────────────────────────────────────────────────

export interface JobPosting {
  url: string;
  company: string;
  title: string;
  location: string;
  description: string;
  requirements: string[];
  responsibilities: string[];
  qualifications: string[];
  keywords: string[];
  rawText: string;
}

// ─── Resume ────────────────────────────────────────────────────────────────────

export interface ResumeData {
  name: string;
  email: string;
  phone: string;
  linkedin: string;
  github: string;
  summary: string;
  skills: string[];
  experience: Experience[];
  education: Education[];
  rawText: string;
}

// ─── Persistent candidate profile ──────────────────────────────────────────────────────────

export interface CandidateProfile {
  version: 1;
  resumePath: string;
  candidate: {
    fullName: string;
    email: string;
    phone: string;
    linkedin: string;
    github: string;
    portfolio: string;
    city: string;
    country: string;
  };
  workAuthorization: {
    authorizedCountries: string[];
    requiresSponsorship: boolean | null;
    visaStatus: string;
  };
  preferences: {
    desiredSalary: string;
    earliestStartDate: string;
    noticePeriod: string;
    locationPreference: string;
    willingToRelocate: boolean | null;
  };
  answerStyle: {
    tone: string;
    maxSentences: number;
    phrasesToAvoid: string[];
  };
  commonAnswers: Record<string, string>;
  applicationDetails?: { gender: string; hometown: string; birthDate: string; workYears: string; desiredIndustry: string; desiredOccupation: string; desiredMonthlySalary: string };
  facts: string[];
  resumeTable?: import("../intake/structured-profile").ResumeTable;
  updatedAt: string;
}

export interface UnresolvedField {
  label: string;
  required: boolean;
  reason: "missing_profile_data" | "low_confidence" | "sensitive_field";
}

export interface Experience {
  title: string;
  company: string;
  duration: string;
  description: string;
}

export interface Education {
  degree: string;
  school: string;
  year: string;
  details?: string;
}

// ─── Evaluation ────────────────────────────────────────────────────────────────

export interface JobEvaluation {
  score: number; // 1-10
  fitAnalysis: string;
  matchStrengths: string[];
  matchGaps: string[];
  recommendation: "strong_match" | "good_match" | "weak_match" | "poor_match";
}

// ─── Form Analysis ─────────────────────────────────────────────────────────────

export type FieldType =
  | "text"
  | "email"
  | "phone"
  | "url"
  | "textarea"
  | "select"
  | "radio"
  | "checkbox"
  | "file"
  | "date"
  | "number"
  | "unknown";

export interface FormField {
  label: string;
  type: FieldType;
  required: boolean;
  placeholder?: string;
  options?: string[]; // for select/radio
  selector: string; // Playwright-compatible selector
  semanticLocator: string; // label-based locator for robustness
  value?: string; // filled value
  isCustomQuestion: boolean;
}

export interface FormAnalysis {
  url: string;
  ats: ATSPlatform;
  fields: FormField[];
  customQuestions: FormField[];
  standardFields: FormField[];
  submitButtonSelector: string;
  resumeUploadSelector?: string;
}

// ─── ATS Platform Detection ────────────────────────────────────────────────────

export type ATSPlatform = "greenhouse" | "lever" | "workday" | "icims" | "taleo" | "unknown";

// ─── Drafted Answers ───────────────────────────────────────────────────────────

export interface DraftedAnswer {
  fieldLabel: string;
  answer: string;
  confidence: number; // 0-1
}

// ─── Application Record ────────────────────────────────────────────────────────

export interface ApplicationRecord {
  id?: number;
  jobUrl: string;
  company: string;
  title: string;
  score: number;
  status: "evaluated" | "explored" | "drafted" | "prefilled" | "skipped";
  answers: DraftedAnswer[];
  createdAt: string;
  updatedAt: string;
}

// ─── Pipeline State ────────────────────────────────────────────────────────────

export interface PipelineState {
  jobUrl: string;
  resumePath: string;
  job?: JobPosting;
  resume?: ResumeData;
  evaluation?: JobEvaluation;
  formAnalysis?: FormAnalysis;
  draftedAnswers?: DraftedAnswer[];
  prefilled: boolean;
}
