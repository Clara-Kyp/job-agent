import type { CandidateProfile, FormAnalysis, DraftedAnswer } from "../types/index.js";
import { resolveProfileField } from "../profile/field-resolver.js";
import type { WebcmdSession } from "./webcmd-session.js";
import {
  fillFieldProgram,
  fillSelectProgram,
  fillRadioProgram,
  uploadResumeProgram,
  scrollToSubmitProgram,
} from "./webcmd-programs.js";

/**
 * Fill a single text-like field via a webcmd browser program.
 */
async function fillField(
  session: WebcmdSession,
  field: { label: string; type: string; selector: string; options?: string[] },
  value: string
): Promise<boolean> {
  try {
    const result = await session.runProgram(fillFieldProgram(field.label, value, field.selector || undefined));
    const { ok } = (result.result ?? {}) as { ok?: boolean };
    if (ok) return true;
  } catch {
    // fall through
  }
  return false;
}

/**
 * Fill a select/dropdown field via a webcmd browser program.
 */
async function fillSelect(
  session: WebcmdSession,
  field: { label: string; selector: string; options?: string[] },
  value: string
): Promise<boolean> {
  try {
    const result = await session.runProgram(fillSelectProgram(field.label, value, field.selector || undefined));
    const { ok } = (result.result ?? {}) as { ok?: boolean };
    return ok === true;
  } catch {
    return false;
  }
}

/**
 * Handle a yes/no or radio field via a webcmd browser program.
 */
async function fillRadio(
  session: WebcmdSession,
  field: { label: string; selector: string },
  value: string
): Promise<boolean> {
  try {
    const result = await session.runProgram(fillRadioProgram(field.label, value, field.selector || undefined));
    const { ok } = (result.result ?? {}) as { ok?: boolean };
    return ok === true;
  } catch {
    return false;
  }
}

/**
 * Upload a resume file to the file input via a webcmd browser program.
 */
export async function uploadResume(
  session: WebcmdSession,
  resumePath: string,
  selector?: string
): Promise<boolean> {
  if (!selector) {
    console.log("  ⚠️  No resume upload field detected, skipping upload");
    return false;
  }

  try {
    console.log("  📎 Uploading resume...");
    const result = await session.runProgram(uploadResumeProgram(selector, resumePath));
    const { ok } = (result.result ?? {}) as { ok?: boolean };
    if (ok === true) {
      console.log("  ✅ Resume uploaded");
      return true;
    }
  } catch (err) {
    console.log(`  ⚠️  Failed to upload resume: ${err instanceof Error ? err.message : err}`);
  }
  return false;
}

/**
 * Fill all detected form fields using semantic locators.
 */
export async function fillForm(
  session: WebcmdSession,
  analysis: FormAnalysis,
  profile: CandidateProfile,
  draftedAnswers: DraftedAnswer[],
  resumePath: string
): Promise<{ filled: number; skipped: number; failed: number }> {
  console.log("\n  📝 Starting form pre-fill...");

  let filled = 0;
  let skipped = 0;
  let failed = 0;

  // 1. Upload resume first
  if (analysis.resumeUploadSelector) {
    const uploaded = await uploadResume(session, resumePath, analysis.resumeUploadSelector);
    if (uploaded) filled++;
    else skipped++;
  }

  // 2. Fill standard fields from resume data
  for (const field of analysis.standardFields) {
    if (field.type === "file") continue; // Already handled

    const { value } = resolveProfileField(field.label, profile);

    if (!value) {
      console.log(`     ⏭️  Skipped: "${field.label}" (no matching resume data)`);
      skipped++;
      continue;
    }

    let success = false;

    switch (field.type) {
      case "select":
        success = await fillSelect(session, field, value);
        break;
      case "radio":
        success = await fillRadio(session, field, value);
        break;
      case "checkbox":
        // Don't auto-check checkboxes (compliance)
        console.log(`     ⏭️  Skipped checkbox: "${field.label}" (human review needed)`);
        skipped++;
        continue;
      default:
        success = await fillField(session, field, value);
    }

    if (success) {
      console.log(`     ✅ Filled: "${field.label}" → ${value.slice(0, 40)}`);
      filled++;
    } else {
      console.log(`     ❌ Failed: "${field.label}"`);
      failed++;
    }
  }

  // 3. Fill custom questions with drafted answers
  for (const answer of draftedAnswers) {
    const field = analysis.customQuestions.find(
      (q) => q.label.toLowerCase() === answer.fieldLabel.toLowerCase()
    );

    if (!field) {
      console.log(`     ⚠️  No matching field for answer: "${answer.fieldLabel}"`);
      failed++;
      continue;
    }

    const success = await fillField(session, field, answer.answer);
    if (success) {
      console.log(`     ✅ Filled custom answer: "${field.label}"`);
      filled++;
    } else {
      console.log(`     ❌ Failed to fill custom answer: "${field.label}"`);
      failed++;
    }
  }

  console.log(`\n  📊 Fill summary: ${filled} filled, ${skipped} skipped, ${failed} failed`);
  return { filled, skipped, failed };
}

/**
 * Scroll to just above the submit button and pause for human review.
 */
export async function pauseBeforeSubmit(session: WebcmdSession, submitSelector: string): Promise<void> {
  console.log("\n  ⏸️  Scrolling to review position...");

  try {
    await session.runProgram(scrollToSubmitProgram(submitSelector));
  } catch {
    // Scrolling is best-effort; the banner still prints.
  }

  console.log("  🛑 ═══════════════════════════════════════════════════════════");
  console.log("  🛑  ApplyFlow Safe-Stop");
  console.log("  🛑  Form successfully pre-filled!");
  console.log("  🛑");
  console.log("  🛑  Please review the drafted answers, EEO/demographics,");
  console.log("  🛑  and click \"Submit Application\" when you're ready.");
  console.log("  🛑 ═══════════════════════════════════════════════════════════");
  console.log("");
}
