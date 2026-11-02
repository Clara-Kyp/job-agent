import type { FormField, FormAnalysis, ATSPlatform, FieldType } from "../types/index.js";
import type { WebcmdSession } from "../filler/webcmd-session.js";
import { analyzeFormProgram, waitForFormProgram } from "../filler/webcmd-programs.js";

/**
 * Map HTML input type to our FieldType enum.
 */
function mapFieldType(inputType: string, tagName: string, ariaLabel?: string): FieldType {
  switch (inputType.toLowerCase()) {
    case "email":
      return "email";
    case "tel":
      return "phone";
    case "url":
      return "url";
    case "file":
      return "file";
    case "date":
      return "date";
    case "number":
      return "number";
    case "checkbox":
      return "checkbox";
    case "radio":
      return "radio";
    case "hidden":
      return "text"; // we skip these anyway
    default:
      break;
  }

  if (tagName.toLowerCase() === "textarea") return "textarea";
  if (tagName.toLowerCase() === "select") return "select";

  // Heuristic from label/placeholder
  const label = (ariaLabel || "").toLowerCase();
  if (label.includes("email")) return "email";
  if (label.includes("phone") || label.includes("tel")) return "phone";
  if (label.includes("url") || label.includes("linkedin") || label.includes("github")) return "url";

  return "text";
}

/**
 * Check if a field is a custom/free-form question (not a standard form field).
 */
function isCustomQuestion(label: string): boolean {
  const standardFields = [
    "first name",
    "last name",
    "full name",
    "email",
    "phone",
    "telephone",
    "linkedin",
    "github",
    "website",
    "portfolio",
    "url",
    "address",
    "city",
    "state",
    "zip",
    "postal",
    "country",
    "resume",
    "cover letter",
    "upload",
    "file",
    "authorization",
    "authorized",
    "work permit",
    "sponsorship",
    "equal employment",
    "eeo",
    "demographic",
    "veteran",
    "disability",
    "gender",
    "race",
    "ethnicity",
    "pronouns",
    "how did you hear",
    "source",
    "referral",
    "start date",
    "salary",
    "compensation",
    "available",
    "notice period",
  ];

  const lowerLabel = label.toLowerCase();
  return !standardFields.some((sf) => lowerLabel.includes(sf));
}

/**
 * Build a semantic locator for a form field.
 * Prioritizes labels > aria-labels > placeholders > names.
 */
function buildSemanticLocator(
  label: string,
  placeholder: string,
  name: string,
  ariaLabel: string
): string {
  if (label) {
    return `getByLabel("${label.replace(/"/g, '\\"')}")`;
  }
  if (ariaLabel) {
    return `getByRole("textbox", { name: "${ariaLabel.replace(/"/g, '\\"')}" })`;
  }
  if (placeholder) {
    return `getByPlaceholder("${placeholder.replace(/"/g, '\\"')}")`;
  }
  if (name) {
    return `[name="${name}"]`;
  }
  return "";
}

/**
 * Raw field metadata as produced by the webcmd analyze program.
 */
interface RawFormField {
  tagName: string;
  type: string;
  name: string;
  id: string;
  label: string;
  placeholder: string;
  required: boolean;
  options: string[];
  selector: string;
  ariaLabel: string;
}

interface AnalyzeRunPayload {
  url: string;
  ats?: ATSPlatform;
  fields: RawFormField[];
  submitSelector?: string;
  resumeSelector?: string | null;
}

/**
 * Analyze all form fields on the current page by running a webcmd browser
 * program inside the QuickJS sandbox.
 */
export async function analyzeFormFields(session: WebcmdSession): Promise<FormAnalysis> {
  console.log("  🔍 Analyzing form DOM structure...");

  const result = await session.runProgram(analyzeFormProgram(), { timeoutMs: 30_000 });
  const payload = (result.result ?? {}) as AnalyzeRunPayload;

  const url = payload.url || "";
  // The analyze program already merges URL-based + DOM-based detection.
  const ats: ATSPlatform = payload.ats || "unknown";

  // Convert raw fields to FormField objects (skip file inputs — handled separately).
  // Clean labels and drop fields with no usable text anchor (label-less
  // radios/checkboxes are skipped so we never blind-fill a wrong control).
  const cleanLabel = (s: string) =>
    s.replace(/[*]+/g, "").replace(/\s+/g, " ").trim();

  const fields: FormField[] = (payload.fields || [])
    .filter((f) => f.type !== "file")
    .map((f) => ({
      label: cleanLabel(f.label || f.placeholder || f.name),
      type: mapFieldType(f.type, f.tagName, f.ariaLabel),
      required: f.required,
      placeholder: f.placeholder || undefined,
      options: f.options && f.options.length > 0 ? f.options : undefined,
      selector: f.selector || "",
      semanticLocator: buildSemanticLocator(f.label, f.placeholder, f.name, f.ariaLabel),
      isCustomQuestion: isCustomQuestion(f.label),
    }))
    .filter((f) => f.label.length > 0);

  const customQuestions = fields.filter((f) => f.isCustomQuestion);
  const standardFields = fields.filter((f) => !f.isCustomQuestion);

  const analysis: FormAnalysis = {
    url,
    ats,
    fields,
    customQuestions,
    standardFields,
    submitButtonSelector: payload.submitSelector || 'button[type="submit"]',
    resumeUploadSelector: payload.resumeSelector || undefined,
  };

  console.log(`  ✅ Found ${fields.length} fields (${customQuestions.length} custom questions)`);
  console.log(`     🏷️  Platform: ${ats}`);
  console.log(`     📋 Standard fields: ${standardFields.map((f) => f.label).join(", ")}`);
  if (customQuestions.length > 0) {
    console.log(`     ❓ Custom questions:`);
    customQuestions.forEach((q) => console.log(`        - ${q.label}`));
  }

  return analysis;
}

/**
 * Wait for the form to load on the page.
 * Candidate selectors cover Greenhouse, Lever, and generic ATS markup.
 */
export async function waitForForm(
  session: WebcmdSession,
  timeout = 15000
): Promise<boolean> {
  const selectors = [
    ".application-form",
    "#application_form",
    ".job-application-form",
    ".postings-form",
    '[class*="application"]',
    "[data-qa*='form']",
    "form",
    'input[type="text"], textarea',
  ];

  try {
    const result = await session.runProgram(waitForFormProgram(selectors, timeout), {
      timeoutMs: timeout + 5_000,
    });
    const found = (result.result as { found?: boolean })?.found;
    if (!found) {
      console.log("  ⚠️  No form detected on page within timeout");
    }
    return found === true;
  } catch {
    console.log("  ⚠️  No form detected on page within timeout");
    return false;
  }
}