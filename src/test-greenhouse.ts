import { scrapeJobPosting, getApplicationFormUrl } from "./evaluator/job-scraper.js";

// Test against a real Greenhouse job board (job detail URL)
const url = "https://boards.greenhouse.io/stripe/jobs/8172510";

try {
  const job = await scrapeJobPosting(url);
  console.log("RESULT:");
  console.log("  title:", job.title);
  console.log("  company:", job.company);
  console.log("  location:", job.location);
  console.log("  desc length:", job.description.length);
  console.log("  keywords:", job.keywords.slice(0, 8).join(", "));
  const formUrl = await getApplicationFormUrl(job);
  console.log("  form URL:", formUrl);
} catch (e) {
  console.log("ERR:", (e as Error).message);
}