import { cfg } from "../config.js";
import { getLLM } from "../llm/provider.js";
import { parseJsonFromText } from "../utils/llm.js";
import type { JobPosting, ResumeData, JobEvaluation } from "../types/index.js";
import { resumeToPromptSummary } from "./resume-parser.js";

const SCORING_PROMPT = `You are an expert job-candidate matching engine. Analyze how well a candidate's resume matches a job posting.

Return a JSON object with exactly these fields:
{
  "score": <number 1-10>,
  "fitAnalysis": "<2-3 sentence analysis of fit>",
  "matchStrengths": ["<strength1>", "<strength2>", ...],
  "matchGaps": ["<gap1>", "<gap2>", ...],
  "recommendation": "<strong_match|good_match|weak_match|poor_match>"
}

Scoring guide:
- 9-10: Excellent match — candidate has nearly all required skills and experience
- 7-8: Good match — candidate has most required skills, minor gaps
- 5-6: Partial match — candidate has some skills but notable gaps
- 3-4: Weak match — candidate is missing several key requirements
- 1-2: Poor match — candidate lacks most required skills

Be honest but fair. Consider transferable skills and potential for growth.`;

/**
 * Use Gemini to evaluate how well a resume matches a job posting.
 */
export async function evaluateJobFit(
  job: JobPosting,
  resume: ResumeData
): Promise<JobEvaluation> {
  console.log("  🧠 Running AI job-fit evaluation via Gemini...");

  if (cfg.mockLLM) {
    console.log("     [MOCK] Using canned evaluation");
    return {
      score: 8,
      fitAnalysis: `[MOCK] ${resume.skills.slice(0, 4).join(", ")} align well with the ${job.title} role's need for ${job.keywords.slice(0, 4).join(", ")}.`,
      matchStrengths: job.keywords.slice(0, 5),
      matchGaps: ["Certificate required (X years seniority), verify before applying"],
      recommendation: "good_match",
    };
  }

  const resumeSummary = resumeToPromptSummary(resume);

  const prompt = `${SCORING_PROMPT}

=== JOB POSTING ===
Company: ${job.company}
Title: ${job.title}
Location: ${job.location}

Description:
${job.description.slice(0, 3000)}

Requirements:
${job.requirements.map((r) => `- ${r}`).join("\n")}

Key Technologies: ${job.keywords.join(", ")}

=== CANDIDATE RESUME ===
${resumeSummary}

Analyze the match and return the JSON evaluation.`;

  // Low temperature for consistent scoring.
  const text = await getLLM().generate(prompt, { temperature: 0.3, json: true });

  // Parse the JSON response
  try {
    const evaluation: JobEvaluation = parseJsonFromText(text) as JobEvaluation;

    // Clamp score
    evaluation.score = Math.max(1, Math.min(10, Math.round(evaluation.score)));
    // Normalize recommendation to a valid enum value
    evaluation.recommendation = validateRecommendation(evaluation.recommendation);

    console.log(`  ✅ Evaluation: ${evaluation.score}/10 (${evaluation.recommendation})`);
    console.log(`     💪 Strengths: ${evaluation.matchStrengths.slice(0, 3).join(", ")}`);
    if (evaluation.matchGaps.length > 0) {
      console.log(`     ⚠️  Gaps: ${evaluation.matchGaps.slice(0, 3).join(", ")}`);
    }

    return evaluation;
  } catch (err) {
    console.error("  ⚠️  Failed to parse AI evaluation, using fallback");
    console.error(`  Raw response: ${text.slice(0, 500)}`);

    // Fallback evaluation based on keyword matching
    return fallbackEvaluation(job, resume);
  }
}

/**
 * Fallback evaluation using keyword matching when LLM parsing fails.
 */
function fallbackEvaluation(job: JobPosting, resume: ResumeData): JobEvaluation {
  const resumeText = resume.rawText.toLowerCase();
  const matchedKeywords = job.keywords.filter((kw) => resumeText.includes(kw.toLowerCase()));
  const matchRatio = job.keywords.length > 0 ? matchedKeywords.length / job.keywords.length : 0.5;

  const score = Math.max(1, Math.min(10, Math.round(matchRatio * 10)));
  let recommendation: JobEvaluation["recommendation"];
  if (score >= 9) recommendation = "strong_match";
  else if (score >= 7) recommendation = "good_match";
  else if (score >= 5) recommendation = "weak_match";
  else recommendation = "poor_match";

  return {
    score,
    fitAnalysis: `Keyword-based evaluation: ${matchedKeywords.length}/${job.keywords.length} job keywords found in resume.`,
    matchStrengths: matchedKeywords.slice(0, 5),
    matchGaps: job.keywords.filter((kw) => !resumeText.includes(kw.toLowerCase())).slice(0, 5),
    recommendation,
  };
}

/**
 * Normalize a recommendation string from the LLM to the closest valid enum value.
 */
function validateRecommendation(value: string): JobEvaluation["recommendation"] {
  const valid: JobEvaluation["recommendation"][] = ["strong_match", "good_match", "weak_match", "poor_match"];
  if (valid.includes(value as JobEvaluation["recommendation"])) {
    return value as JobEvaluation["recommendation"];
  }

  // Map common LLM variants to the closest valid value.
  const lower = value.toLowerCase().trim();
  if (/strong|excellent|perfect/.test(lower)) return "strong_match";
  if (/good|solid|decent|great/.test(lower)) return "good_match";
  if (/weak|partial|some/.test(lower)) return "weak_match";
  if (/poor|no match|not/.test(lower)) return "poor_match";

  // Default by score range as a last resort.
  return "good_match";
}
