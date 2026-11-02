import * as cheerio from "cheerio";
import type { JobPosting, ATSPlatform } from "../types/index.js";
import { retry } from "../utils/retry.js";
import { WebcmdSession } from "../filler/webcmd-session.js";
import { renderRenderedHtmlProgram } from "../filler/webcmd-programs.js";
import { cfg } from "../config.js";

/** Shape of the Greenhouse board jobs API response. */
interface GreenhouseJob {
  id: number;
  title: string;
  company_name?: string;
  content?: string;
  location?: { name?: string };
}

/**
 * Detect which ATS platform hosts this job posting.
 */
function detectATS(url: string): ATSPlatform {
  const u = url.toLowerCase();
  if (u.includes("greenhouse.io") || u.includes("boards.greenhouse")) return "greenhouse";
  if (u.includes("lever.co") || u.includes("jobs.lever")) return "lever";
  if (u.includes("workday.com") || u.includes("myworkdayjobs")) return "workday";
  if (u.includes("icims.com")) return "icims";
  if (u.includes("taleo")) return "taleo";
  return "unknown";
}

/**
 * Extract structured data from a Greenhouse job posting page.
 */
function parseGreenhouse($: cheerio.CheerioAPI, url: string): Partial<JobPosting> {
  const title = $("h1").first().text().trim() || $(".posting-headline h2").text().trim();
  const location = $(".posting-headline .location").text().trim() || $(".location").first().text().trim();

  // Greenhouse puts the job description in .content or #content
  const contentEl = $(".content, #content, .posting-content").first();
  const description = contentEl.text().trim();

  // Extract sections
  const sections: string[] = [];
  contentEl.find("h2, h3").each((_, el) => {
    sections.push($(el).text().trim());
  });

  const lists: string[][] = [];
  contentEl.find("ul").each((_, ul) => {
    const items: string[] = [];
    $(ul)
      .find("li")
      .each((_, li) => {
        items.push($(li).text().trim());
      });
    lists.push(items);
  });

  return { title, location, description, rawText: description };
}

/**
 * Extract structured data from a Lever job posting page.
 */
function parseLever($: cheerio.CheerioAPI, url: string): Partial<JobPosting> {
  const title = $(".posting-name").text().trim() || $("h1").first().text().trim();
  const location = $(".posting-locations").text().trim() || $(".location").first().text().trim();

  const contentEl = $(".posting-page").first();
  const description = contentEl.text().trim();

  return { title, location, description, rawText: description };
}

/**
 * Generic parser for unknown ATS platforms.
 */
function parseGeneric($: cheerio.CheerioAPI, url: string): Partial<JobPosting> {
  const title = $("h1").first().text().trim() || $("title").text().trim();
  const location =
    $('[class*="location"], [data-qa*="location"], [itemprop="jobLocation"]').first().text().trim() || "";

  // Get all text content from the main area
  const mainEl = $("main, article, .job-description, #job-description, [role='main']").first();
  const description = mainEl.length ? mainEl.text().trim() : $("body").text().trim();

  return { title, location, description, rawText: description };
}

/**
 * Extract keywords from the job description text.
 */
function extractKeywords(text: string): string[] {
  const techKeywords = [
    "javascript", "typescript", "python", "java", "c\\+\\+", "c#", "go", "rust", "ruby",
    "react", "vue", "angular", "node\\.js", "express", "fastapi", "django", "flask",
    "sql", "postgresql", "mysql", "mongodb", "redis", "elasticsearch",
    "aws", "gcp", "azure", "docker", "kubernetes", "terraform", "ci/cd",
    "machine learning", "deep learning", "nlp", "computer vision", "data science",
    "rest", "graphql", "grpc", "microservices", "agile", "scrum",
    "git", "linux", "bash", "html", "css", "sass",
    "figma", "sketch", "adobe",
    "communication", "leadership", "team", "collaboration", "problem-solving",
  ];

  const lowerText = text.toLowerCase();
  const found: string[] = [];

  for (const kw of techKeywords) {
    const regex = new RegExp(`\\b${kw}\\b`, "i");
    if (regex.test(lowerText)) {
      found.push(kw.replace(/\\\\/g, ""));
    }
  }

  return [...new Set(found)];
}

/**
 * Extract list sections from raw text (requirements, responsibilities, qualifications).
 */
function extractSections(
  text: string
): { requirements: string[]; responsibilities: string[]; qualifications: string[] } {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const requirements: string[] = [];
  const responsibilities: string[] = [];
  const qualifications: string[] = [];

  let currentSection: "requirements" | "responsibilities" | "qualifications" | null = null;

  for (const line of lines) {
    const lower = line.toLowerCase();

    if (lower.includes("requirement") || lower.includes("what you need") || lower.includes("must have")) {
      currentSection = "requirements";
      continue;
    }
    if (lower.includes("responsibilit") || lower.includes("what you'll do") || lower.includes("what you will do")) {
      currentSection = "responsibilities";
      continue;
    }
    if (lower.includes("qualification") || lower.includes("nice to have") || lower.includes("bonus")) {
      currentSection = "qualifications";
      continue;
    }

    // Check for section break (new heading without bullets)
    if (!line.startsWith("•") && !line.startsWith("-") && !line.startsWith("*") && line.length < 50) {
      const isSectionHeader =
        lower.includes("about") ||
        lower.includes("benefit") ||
        lower.includes("perks") ||
        lower.includes("compensation");
      if (isSectionHeader) {
        currentSection = null;
        continue;
      }
    }

    if (currentSection && (line.startsWith("•") || line.startsWith("-") || line.startsWith("*") || line.length > 20)) {
      const cleaned = line.replace(/^[•\-\*]\s*/, "").trim();
      if (cleaned.length > 5) {
        switch (currentSection) {
          case "requirements":
            requirements.push(cleaned);
            break;
          case "responsibilities":
            responsibilities.push(cleaned);
            break;
          case "qualifications":
            qualifications.push(cleaned);
            break;
        }
      }
    }
  }

  return { requirements, responsibilities, qualifications };
}

/**
 * Fetch a Greenhouse job posting from the public JSON API
 * (boards-api.greenhouse.io). This is dramatically more reliable than
 * HTML scraping — the API returns structured title/location/description.
 */
async function scrapeGreenhouseAPI(url: string): Promise<JobPosting | null> {
  const urlObj = new URL(url);
  const segments = urlObj.pathname.split("/").filter(Boolean);

  // boards.greenhouse.io/<company>[/jobs[/<id>]]
  if (urlObj.hostname !== "boards.greenhouse.io") {
    // Support boards-api.greenhouse.io/v1/boards/... style too
    if (urlObj.hostname !== "boards-api.greenhouse.io") return null;
  }
  const company = segments[0];
  if (!company) return null;

  const jobsIdx = segments.indexOf("jobs");
  const jobId = jobsIdx >= 0 ? segments[jobsIdx + 1] : undefined;

  const apiBase = `https://boards-api.greenhouse.io/v1/boards/${company}/jobs`;
  try {
    let job: GreenhouseJob;

    if (jobId) {
      const res = await retry(() =>
        fetch(`${apiBase}/${jobId}?content=true`, { headers: { "User-Agent": "ApplyFlow/1.0" } })
      );
      if (!res.ok) return null;
      job = await res.json() as GreenhouseJob;
    } else {
      const res = await retry(() =>
        fetch(`${apiBase}?content=true`, { headers: { "User-Agent": "ApplyFlow/1.0" } })
      );
      if (!res.ok) return null;
      const data = await res.json() as { jobs?: GreenhouseJob[] };
      if (!Array.isArray(data.jobs) || data.jobs.length === 0) return null;
      job = data.jobs[0];
    }

    // Decode HTML content to plain text for the LLM.
    const $content = cheerio.load(job.content || "");
    const rawText = $content.text().trim() || (job.content || "").replace(/<[^>]+>/g, " ").trim();

    return {
      url,
      company: job.company_name || company,
      title: job.title || "Unknown Title",
      location: job.location?.name || "Not specified",
      description: rawText.slice(0, 8000),
      requirements: [],
      responsibilities: [],
      qualifications: [],
      keywords: extractKeywords(rawText),
      rawText,
    };
  } catch {
    return null;
  }
}

/**
 * Render a URL with a real Chrome window managed by the webcmd daemon and
 * extract the page's rendered HTML. Greenhouse's board list is a JS-rendered
 * SPA, so static HTML parsing alone misses it. We fall back to this when the
 * static parse returns no meaningful job content.
 *
 * The rendering runs as a webcmd QuickJS program; the returned HTML is large,
 * so a much larger output cap is requested for this run.
 */
async function renderAndExtractText(url: string): Promise<{ html: string; finalUrl: string }> {
  const session = new WebcmdSession(cfg.webcmdProfile, "render");
  try {
    await session.launch();
    // Ask up to ~3MB back so full-page serialized HTML isn't truncated.
    const result = await session.runProgram(renderRenderedHtmlProgram(url), {
      timeoutMs: 60_000,
      maxOutputChars: 3_000_000,
    });
    const payload = (result.result ?? {}) as { html?: string; url?: string };
    const html = payload.html ?? "";
    const finalUrl = payload.url || url;
    if (!html) throw new Error("webcmd render returned no HTML content");
    return { html, finalUrl };
  } finally {
    await session.close();
  }
}

/**
 * Scrape and parse a job posting from a URL.
 */
export async function scrapeJobPosting(url: string): Promise<JobPosting> {
  console.log(`  📡 Fetching job posting: ${url}`);

  const ats = detectATS(url);

  // Greenhouse: use the public JSON API first — far more reliable than HTML.
  if (ats === "greenhouse") {
    console.log("  🔍 Detected ATS platform: greenhouse (using public JSON API)");
    const viaApi = await scrapeGreenhouseAPI(url);
    if (viaApi) {
      console.log(`  ✅ Parsed: "${viaApi.title}" at ${viaApi.company}`);
      console.log(`     📍 ${viaApi.location}`);
      console.log(`     🏷️  Found ${viaApi.keywords.length} keywords`);
      return viaApi;
    }
    console.log("  ⚠️  JSON API unavailable, falling back to HTML scrape");
  }

  let html: string;
  let finalUrl = url;

  // First try a lightweight static fetch.
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });
    if (response.ok) {
      html = await response.text();
    } else {
      // Fall back to the browser render below.
      html = "";
    }
  } catch {
    html = "";
  }

  console.log(`  🔍 Detected ATS platform: ${ats}`);

  let $ = cheerio.load(html || "<html></html>");
  let parsed: Partial<JobPosting> = {};
  let parseUrl = url;
  let listMode = false;

  const tryParse = () => {
    parsed = (() => {
      switch (ats) {
        case "greenhouse":
          return parseGreenhouse($, parseUrl);
        case "lever":
          return parseLever($, parseUrl);
        default:
          return parseGeneric($, parseUrl);
      }
    })();
  };

  tryParse();

  // A specific job page must have a title and some description content.
  // Greenhouse job detail pages expose `a[href*="job_app"]` (the Apply link).
  const looksLikeRealJob = !!(
    parsed.title &&
    parsed.title !== "Unknown Title" &&
    (parsed.description || $('a[href*="job_app"]').length > 0)
  );

  // If static parse yielded no real job data (JS-rendered board/SPA), render
  // the page with headless Chromium and re-parse — Greenhouse boards and some
  // Lever posts are client-side rendered.
  if (!looksLikeRealJob) {
    console.log("  🔁 Static HTML insufficient (JS-rendered page) → rendering with headless Chromium...");
    const rendered = await renderAndExtractText(url);
    html = rendered.html;
    finalUrl = rendered.finalUrl;
    parseUrl = finalUrl.startsWith("http") ? finalUrl : url;
    $ = cheerio.load(html);

    tryParse();

    // Board list rendered: follow the first specific job posting (/jobs/<id>).
    if (
      ats === "greenhouse" &&
      $(".openings, .board-postings").length > 0 &&
      $(".job-post, .posting, .posting-headline").length === 0
    ) {
      listMode = true;
    }
  }

  if (listMode) {
    const firstJobHref = $('a[href*="/jobs/"]').first().attr("href");
    if (firstJobHref) {
      const jobUrl = firstJobHref.startsWith("http")
        ? firstJobHref
        : new URL(firstJobHref, url).href;
      console.log(`  🔗 Board list detected → following first job: ${jobUrl}`);
      return scrapeJobPosting(jobUrl);
    }
  }

  // Extract company from URL or page
  const urlObj = new URL(parseUrl);
  const hostParts = urlObj.hostname.replace(/^www\./, "").split(".");
  const pathSegments = urlObj.pathname.split("/").filter(Boolean);
  const companyFromPath =
    ats === "greenhouse" && pathSegments.length > 0
      ? pathSegments[0]
      : ats === "lever" && hostParts[0] !== "jobs"
        ? hostParts[0]
        : "";

  const company =
    $(".company-name").first().text().trim() ||
    $('[class*="company"]').first().text().trim() ||
    companyFromPath ||
    hostParts[0];

  const rawText = parsed.rawText || parsed.description || "";
  const { requirements, responsibilities, qualifications } = extractSections(rawText);
  const keywords = extractKeywords(rawText);

  const job: JobPosting = {
    url,
    company,
    title: parsed.title || "Unknown Title",
    location: parsed.location || "Not specified",
    description: parsed.description || rawText.slice(0, 2000),
    requirements,
    responsibilities,
    qualifications,
    keywords,
    rawText,
  };

  console.log(`  ✅ Parsed: "${job.title}" at ${job.company}`);
  console.log(`     📍 ${job.location}`);
  console.log(`     🏷️  Found ${keywords.length} keywords, ${requirements.length} requirements`);

  return job;
}

/**
 * Resolve the *application form* URL for a parsed job, using the parsed job
 * metadata (company, job id) rather than re-scraping the page. For Greenhouse
 * this builds the stable embed/job_app URL that hosts the actual form.
 */
export async function getApplicationFormUrl(job: JobPosting): Promise<string> {
  const ats = detectATS(job.url);

  if (ats === "greenhouse") {
    // Try to pull a real job id from the API so we can build the embed URL.
    const urlObj = new URL(job.url);
    const segments = urlObj.pathname.split("/").filter(Boolean);
    const company = segments[0];
    const jobsIdx = segments.indexOf("jobs");
    const idFromPath = jobsIdx >= 0 ? segments[jobsIdx + 1] : undefined;

    if (company) {
      if (idFromPath) {
        return `https://boards.greenhouse.io/embed/job_app?for=${company}&token=${idFromPath}`;
      }
      // Resolve the first job with the API to find an id.
      try {
        const res = await retry(() =>
          fetch(`https://boards-api.greenhouse.io/v1/boards/${company}/jobs?content=false`, {
            headers: { "User-Agent": "ApplyFlow/1.0" },
          })
        );
        if (res.ok) {
          const data = await res.json() as { jobs?: GreenhouseJob[] };
          if (Array.isArray(data.jobs) && data.jobs[0]?.id) {
            const id = data.jobs[0].id;
            return `https://boards.greenhouse.io/embed/job_app?for=${company}&token=${id}`;
          }
        }
      } catch {
        /* fall through */
      }
      return `https://boards.greenhouse.io/embed/job_app?for=${company}`;
    }
  }

  // Lever's job page contains an Apply link; the actual fields live at /apply.
  // Keep an existing /apply URL intact so direct application links also work.
  if (ats === "lever") {
    const url = new URL(job.url);
    if (!url.pathname.replace(/\/$/, "").endsWith("/apply")) {
      url.pathname = `${url.pathname.replace(/\/$/, "")}/apply`;
    }
    return url.toString();
  }

  return job.url;
}
