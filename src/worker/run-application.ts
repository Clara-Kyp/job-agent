import { existsSync, readFileSync } from "node:fs";
import { basename } from "node:path";
import { scrapeJobPosting, getApplicationFormUrl } from "../evaluator/job-scraper.js";
import { parseResume, parseResumeText } from "../evaluator/resume-parser.js";
import { readIntakeText } from "../intake/read-file.js";
import { evaluateJobFit } from "../evaluator/scorer.js";
import { analyzeFormFields, waitForForm } from "../explorer/form-analyzer.js";
import { draftAnswers } from "../drafter/answer-generator.js";
import { WebcmdSession } from "../filler/webcmd-session.js";
import { fillForm, pauseBeforeSubmit } from "../filler/form-filler.js";
import { saveApplication, updateApplicationStatus, initDB } from "../tracker/database.js";
import type { DraftedAnswer, FormAnalysis, JobEvaluation, JobPosting, ResumeData } from "../types/index.js";
import type { CandidateProfile, UnresolvedField } from "../types/index.js";
import { loadProfile, profileFromResume, saveProfile } from "../profile/profile-store.js";
import { unresolvedStandardFields } from "../profile/field-resolver.js";
import { applyRuntimeSettings } from "../config.js";
import { resetLLMProvider } from "../llm/provider.js";

export type ApplicationStage =
  | "validating"
  | "extracting"
  | "evaluating"
  | "exploring"
  | "questions"
  | "drafting"
  | "prefilling"
  | "review"
  | "failed";

export interface ApplicationProgress {
  stage: ApplicationStage;
  message: string;
  job?: JobPosting;
  resume?: ResumeData;
  evaluation?: JobEvaluation;
  formAnalysis?: FormAnalysis;
  draftedAnswers?: DraftedAnswer[];
  filled?: number;
  skipped?: number;
  failed?: number;
  error?: string;
  unresolvedFields?: UnresolvedField[];
}

export interface ApplicationPayload {
  jobUrl: string;
  resumePath: string;
  mockLLM?: boolean;
  slowMo?: number;
  geminiApiKey?: string;
  anthropicApiKey?: string;
  openaiApiKey?: string;
  openaiModel?: string;
  openaiBaseUrl?: string;
  geminiModel?: string;
  anthropicModel?: string;
  llmProvider?: string;
  profilePath?: string;
  onQuestions?: (fields: UnresolvedField[], profile: CandidateProfile) => Promise<CandidateProfile>;
  onProgress?: (progress: ApplicationProgress) => void | Promise<void>;
}

export interface ApplicationResult {
  status: "review";
  job: JobPosting;
  resume: ResumeData;
  evaluation: JobEvaluation;
  formAnalysis: FormAnalysis;
  draftedAnswers: DraftedAnswer[];
  filled: number;
  skipped: number;
  failed: number;
  unresolvedFields: UnresolvedField[];
}

function report(payload: ApplicationPayload, progress: ApplicationProgress): void | Promise<void> {
  console.log(`  [${progress.stage}] ${progress.message}`);
  return payload.onProgress?.(progress);
}

export async function runApplication(payload: ApplicationPayload): Promise<ApplicationResult> {
  if (!payload.jobUrl) throw new Error("Job URL is required.");
  if (!existsSync(payload.resumePath)) throw new Error(`Resume not found: ${payload.resumePath}`);

  applyRuntimeSettings(payload);
  resetLLMProvider();
  initDB();
  const session = new WebcmdSession();
  let applicationId: number | undefined;
  let keepSessionOpen = false;

  try {
    await report(payload, { stage: "validating", message: "Validating job URL and preparing the application run." });

    await report(payload, { stage: "extracting", message: "Scraping the job posting and extracting resume data." });
    const job = await scrapeJobPosting(payload.jobUrl);
    const resumeText = await readIntakeText(new File([readFileSync(payload.resumePath)], basename(payload.resumePath)), true);
    const resume: ResumeData = parseResumeText(resumeText);
    let profile = loadProfile(payload.profilePath) || profileFromResume(resume, payload.resumePath);

    await report(payload, { stage: "evaluating", message: "Evaluating resume fit against the job posting." });
    const evaluation = await evaluateJobFit(job, resume);
    applicationId = saveApplication({
      jobUrl: payload.jobUrl,
      company: job.company,
      title: job.title,
      score: evaluation.score,
      status: "evaluated",
      answers: [],
    });

    await report(payload, { stage: "exploring", message: "Launching the visible browser and mapping application fields." });
    await session.launch();
    await session.navigate(await getApplicationFormUrl(job));
    if (!(await waitForForm(session))) throw new Error("No application form was detected.");
    const formAnalysis = await analyzeFormFields(session);
    updateApplicationStatus(applicationId, "explored");

    let unresolvedFields = unresolvedStandardFields(formAnalysis.standardFields, profile);
    if (unresolvedFields.length > 0) {
      await report(payload, {
        stage: "questions",
        message: `${unresolvedFields.length} field(s) need confirmed profile data.`,
        unresolvedFields,
      });
      if (payload.onQuestions) {
        profile = await payload.onQuestions(unresolvedFields, profile);
        saveProfile(profile, payload.profilePath);
        unresolvedFields = unresolvedStandardFields(formAnalysis.standardFields, profile);
      }
    }

    await report(payload, { stage: "drafting", message: "Drafting tailored answers for custom screening questions." });
    let draftedAnswers = await draftAnswers(formAnalysis.customQuestions, job, resume, profile);
    let unansweredCustom = formAnalysis.customQuestions
      .filter((field) => !draftedAnswers.some((answer) => answer.fieldLabel.toLowerCase() === field.label.toLowerCase()))
      .map((field) => ({
        label: field.label,
        required: field.required,
        reason: "low_confidence" as const,
      }));
    if (unansweredCustom.length > 0 && payload.onQuestions) {
      await report(payload, {
        stage: "questions",
        message: `${unansweredCustom.length} custom question(s) could not be answered safely.`,
        unresolvedFields: unansweredCustom,
      });
      profile = await payload.onQuestions(unansweredCustom, profile);
      saveProfile(profile, payload.profilePath);
      draftedAnswers = await draftAnswers(formAnalysis.customQuestions, job, resume, profile);
      unansweredCustom = formAnalysis.customQuestions
        .filter((field) => !draftedAnswers.some((answer) => answer.fieldLabel.toLowerCase() === field.label.toLowerCase()))
        .map((field) => ({ label: field.label, required: field.required, reason: "low_confidence" as const }));
    }
    unresolvedFields = [...unresolvedFields, ...unansweredCustom];
    updateApplicationStatus(applicationId, "drafted");

    await report(payload, { stage: "prefilling", message: "Filling standard fields and attaching the resume PDF." });
    const fillSummary = await fillForm(session, formAnalysis, profile, draftedAnswers, payload.resumePath);
    updateApplicationStatus(applicationId, "prefilled");

    await pauseBeforeSubmit(session, formAnalysis.submitButtonSelector);
    keepSessionOpen = true;
    const result: ApplicationResult = {
      status: "review",
      job,
      resume,
      evaluation,
      formAnalysis,
      draftedAnswers,
      unresolvedFields,
      ...fillSummary,
    };
    await report(payload, {
      stage: "review",
      message: "Safe-stop reached. Review the populated application before submitting.",
      ...result,
    });
    return result;
  } catch (error) {
    if (applicationId) updateApplicationStatus(applicationId, "skipped");
    const message = error instanceof Error ? error.message : String(error);
    await report(payload, { stage: "failed", message, error: message });
    throw error;
  } finally {
    if (!keepSessionOpen) await session.close();
  }
}
