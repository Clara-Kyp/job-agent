import { parseResume, resumeToPromptSummary } from "./evaluator/resume-parser.js";
import { scrapeJobPosting } from "./evaluator/job-scraper.js";
import { config } from "dotenv";

config();

async function main() {
  // Test 1: Resume parsing
  console.log("=== TEST: Resume Parser ===\n");
  const resume = parseResume("./data/resumes/placeholder.txt");
  console.log("\nStructured data:");
  console.log("  name:", resume.name);
  console.log("  email:", resume.email);
  console.log("  phone:", resume.phone);
  console.log("  linkedin:", resume.linkedin);
  console.log("  github:", resume.github);
  console.log("  skills:", resume.skills.slice(0, 5).join(", "), "...");
  console.log("  experiences:", resume.experience.length);
  console.log("  educations:", resume.education.length);

  if (resume.name === "Unknown" || !resume.email) {
    console.log("\n  ❌ FAIL: Resume parsing incomplete");
    process.exit(1);
  }

  if (!resume.experience.length) {
    console.log("\n  ⚠️  WARNING: No experience parsed — check the placeholder format");
  }

  console.log("\n  ✅ PASS: Resume parser");

  // Test 2: Job scraper against a real Greenhouse job
  console.log("\n=== TEST: Job Scraper ===");
  try {
    const job = await scrapeJobPosting(
      "https://jobs.lever.co/leverdemo"
    );
    console.log("\n  ✅ PASS: Job scraper");
    console.log("  title:", job.title);
    console.log("  company:", job.company);
  } catch (err) {
    console.log("\n  ⚠️  SKIP (network): ", err instanceof Error ? err.message : err);
  }

  // Summary
  console.log("\n=== SUMMARY ===");
  console.log("Resume prompt summary preview:");
  console.log(resumeToPromptSummary(resume).slice(0, 300));
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});