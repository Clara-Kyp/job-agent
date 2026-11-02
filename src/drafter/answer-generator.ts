import { cfg } from "../config.js";
import { getLLM } from "../llm/provider.js";
import { parseJsonFromText } from "../utils/llm.js";
import type { CandidateProfile, FormField, DraftedAnswer, JobPosting, ResumeData } from "../types/index.js";
import { resumeToPromptSummary } from "../evaluator/resume-parser.js";

const ANSWER_PROMPT = `You are a job application assistant. Draft concise, high-impact answers for job application form questions.

RULES:
1. Keep answers SHORT (2-4 sentences max for most questions)
2. Be specific — reference actual projects and experiences from the resume
3. Mirror keywords from the job description naturally
4. Sound human, NOT like generic AI boilerplate
5. For yes/no questions, give the direct answer first
6. For demographic/EEO questions, keep answers minimal and factual
7. Never fabricate experiences not in the resume
8. Match the tone of the company (startup = casual, enterprise = formal)
9. Treat the candidate profile as the only source of truth. If the answer is not supported, return an empty answer with confidence 0.
10. Follow the candidate's saved writing style and reuse remembered answers when relevant.

Return a JSON array of objects:
[
  {
    "fieldLabel": "<exact field label>",
    "answer": "<the drafted answer>",
    "confidence": <0.0 to 1.0>
  }
]

Only include fields that need text answers. Skip file uploads, checkboxes, and simple yes/no fields that are already handled.`;

/**
 * Draft answers for custom questions on the application form.
 */
export async function draftAnswers(
  customQuestions: FormField[],
  job: JobPosting,
  resume: ResumeData,
  profile?: CandidateProfile,
): Promise<DraftedAnswer[]> {
  if (customQuestions.length === 0) {
    console.log("  ℹ️  No custom questions to draft answers for");
    return [];
  }

  console.log(`  ✍️  Drafting answers for ${customQuestions.length} custom questions...`);

  if (cfg.mockLLM) {
    console.log("     [MOCK] Using canned draft answers");
    await new Promise((r) => setTimeout(r, 300)); // tiny delay so the demo reads naturally
    return customQuestions
      .filter((q) => q.type === "textarea" || q.type === "text")
      .map((q) => ({
        fieldLabel: q.label,
        answer:
          `I'm drawn to the ${job.title} role at ${job.company} because it builds directly on the ` +
          `${resume.skills.slice(0, 3).join(", ")} experience I'd bring, and the open problems it tackles ` +
          `match where I want to grow next. I focused a lot of my recent work on shipping polished, ` +
          `production-quality features (see my projects), and I'd love to apply that to your team.`,
        confidence: 0.9,
      }));
  }

  const resumeSummary = resumeToPromptSummary(resume);

  const questionsList = customQuestions
    .map(
      (q, i) =>
        `${i + 1}. "${q.label}" (type: ${q.type}${q.required ? ", REQUIRED" : ""}${
          q.options ? `, options: ${q.options.join(", ")}` : ""
        })`
    )
    .join("\n");

  const prompt = `${ANSWER_PROMPT}

=== JOB POSTING ===
Company: ${job.company}
Title: ${job.title}
Key Requirements: ${job.requirements.slice(0, 5).join("; ")}
Key Technologies: ${job.keywords.join(", ")}

=== CANDIDATE RESUME ===
${resumeSummary}

=== VERIFIED CANDIDATE PROFILE ===
${profile ? JSON.stringify({
  workAuthorization: profile.workAuthorization,
  preferences: profile.preferences,
  answerStyle: profile.answerStyle,
  commonAnswers: profile.commonAnswers,
  facts: profile.facts,
}, null, 2) : "No saved profile was provided."}

=== QUESTIONS TO ANSWER ===
${questionsList}

Draft answers for each question above. Return the JSON array.`;

  const text = await getLLM().generate(prompt, { json: true });

  try {
    const answers = (parseJsonFromText(text) as DraftedAnswer[]).filter(
      (answer) => answer.answer?.trim() && Number(answer.confidence) >= 0.65,
    );

    // Validate and log
    for (const answer of answers) {
      const conf = answer.confidence || 0.8;
      const icon = conf >= 0.8 ? "✅" : conf >= 0.5 ? "🟡" : "⚠️";
      console.log(`     ${icon} "${answer.fieldLabel}" → ${answer.answer.slice(0, 60)}...`);
    }

    console.log(`  ✅ Drafted ${answers.length} answers`);
    return answers;
  } catch (err) {
    console.error("  ⚠️  Failed to parse AI-generated answers, using fallback");
    console.error(`  Raw response: ${text.slice(0, 500)}`);

    // Fallback: generate simple answers from resume
    return fallbackAnswers(customQuestions, job, resume);
  }
}

/**
 * Fallback answer generation using template-based approach.
 */
function fallbackAnswers(
  questions: FormField[],
  job: JobPosting,
  resume: ResumeData
): DraftedAnswer[] {
  return questions
    .filter((q) => q.type === "textarea" || q.type === "text")
    .map((q) => {
      const lowerLabel = q.label.toLowerCase();
      let answer = "";

      if (lowerLabel.includes("why") || lowerLabel.includes("interest")) {
        answer = `I'm excited about the ${job.title} role at ${job.company} because it aligns with my experience in ${resume.skills.slice(0, 3).join(", ")}. I believe my background would allow me to make meaningful contributions to your team.`;
      } else if (lowerLabel.includes("strength")) {
        answer = `My strongest skills are ${resume.skills.slice(0, 3).join(", ")}, which I've developed through my experience${resume.experience.length > 0 ? ` at ${resume.experience[0].company}` : ""}.`;
      } else if (lowerLabel.includes("challenge") || lowerLabel.includes("problem")) {
        answer = `I enjoy tackling complex technical challenges. For example, I've worked on projects involving ${resume.skills.slice(0, 2).join(" and ")}, which required creative problem-solving.`;
      } else {
        answer = resume.summary
          ? resume.summary.slice(0, 300)
          : `I bring experience in ${resume.skills.slice(0, 3).join(", ")} and am eager to contribute to ${job.company}.`;
      }

      return {
        fieldLabel: q.label,
        answer,
        confidence: 0.5,
      };
    });
}
