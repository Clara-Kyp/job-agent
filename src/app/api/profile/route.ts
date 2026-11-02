import { existsSync, readFileSync } from "node:fs";
import { basename, extname } from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { readArchive } from "../../../intake/archive";
import { parsePersonalSheet } from "../../../intake/personal-sheet";
import { INTAKE_CATEGORIES, type IntakeCategory } from "../../../intake/categories";
import { checkLocalRequest, INTAKE_ROOT, saveIntake, type IntakeManifest } from "../../../intake/local-store";
import { readResume } from "../../../intake/parse-resume";
import { RESUME_SECTIONS, type DocumentDetails, type ResumeTable } from "../../../intake/structured-profile";
import { loadProfile, profileFromResume, saveProfile } from "../../../profile/profile-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ConfirmedProfile {
  fullName: string;
  email: string;
  phone: string;
  city: string;
  country: string;
  desiredSalary: string;
  earliestStartDate: string;
  locationPreference: string;
  visaStatus: string;
  sponsorship: "yes" | "no" | "unknown";
  gender?: string; hometown?: string; birthDate?: string; workYears?: string; desiredIndustry?: string; desiredOccupation?: string; desiredMonthlySalary?: string;
}

function stringValue(value: unknown, max = 200): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, max);
}

function parseResumeTable(raw: FormDataEntryValue | null): ResumeTable {
  if (typeof raw !== "string") return {};
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid resume template.");
  const table: ResumeTable = {};
  for (const section of RESUME_SECTIONS) {
    const rows = (value as Record<string, unknown>)[section.id];
    if (rows === undefined) continue;
    if (!Array.isArray(rows) || rows.length > 30) throw new Error(`Too many rows in ${section.title}.`);
    table[section.id] = rows.map((row) => {
      if (!Array.isArray(row) || row.length !== section.columns.length) throw new Error(`Invalid row in ${section.title}.`);
      return row.map((cell) => stringValue(cell, 1000));
    }).filter((row) => row.some(Boolean));
  }
  return table;
}

function parseDocumentDetails(raw: FormDataEntryValue | null, count: number): DocumentDetails[] {
  if (typeof raw !== "string") return Array.from({ length: count }, () => ({ title: "", issuedAt: "", issuer: "", scoreOrResult: "", expiresAt: "", notes: "" }));
  const value: unknown = JSON.parse(raw);
  if (!Array.isArray(value) || value.length !== count) throw new Error("Document information does not match uploaded files.");
  return value.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("Invalid document information.");
    const data = item as Record<string, unknown>;
    return { title: stringValue(data.title), issuedAt: stringValue(data.issuedAt, 50), issuer: stringValue(data.issuer), scoreOrResult: stringValue(data.scoreOrResult), expiresAt: stringValue(data.expiresAt, 50), notes: stringValue(data.notes, 1000) };
  });
}

function tableFactsFor(table: ResumeTable): string[] {
  return RESUME_SECTIONS.flatMap((section) => (table[section.id] || []).map((row) => `${section.title}: ${row.map((value, index) => value ? `${section.columns[index]} ${value}` : "").filter(Boolean).join("；")}`));
}

export async function GET(request: NextRequest) {
  try {
    checkLocalRequest(request);
    const profile = loadProfile();
    return NextResponse.json({
      ready: Boolean(profile && existsSync(profile.resumePath)),
      candidateName: profile?.candidate.fullName || "",
      updatedAt: profile?.updatedAt || null,
      resumeName: profile?.resumePath.split("/").pop() || "",
      confirmed: profile ? {
        fullName: profile.candidate.fullName,
        email: profile.candidate.email,
        phone: profile.candidate.phone,
        city: profile.candidate.city,
        country: profile.candidate.country,
        desiredSalary: profile.preferences.desiredSalary,
        earliestStartDate: profile.preferences.earliestStartDate,
        locationPreference: profile.preferences.locationPreference,
        visaStatus: profile.workAuthorization.visaStatus,
        sponsorship: profile.workAuthorization.requiresSponsorship === true ? "yes" : profile.workAuthorization.requiresSponsorship === false ? "no" : "unknown",
        gender: profile.applicationDetails?.gender || "", hometown: profile.applicationDetails?.hometown || "", birthDate: profile.applicationDetails?.birthDate || "", workYears: profile.applicationDetails?.workYears || "", desiredIndustry: profile.applicationDetails?.desiredIndustry || "", desiredOccupation: profile.applicationDetails?.desiredOccupation || "", desiredMonthlySalary: profile.applicationDetails?.desiredMonthlySalary || "",
      } : null,
      resumeTable: profile?.resumeTable || {},
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Profile unavailable." }, { status: 400 });
  }
}

export async function POST(request: NextRequest) {
  try {
    checkLocalRequest(request);
    const form = await request.formData();
    const archive = form.get("archive");
    const archived = archive instanceof File ? await readArchive(archive) : null;
    if (archived) await parsePersonalSheet(archived.personalSheet);
    const uploadedResume = archived?.entries.find((entry) => entry.category === "resume")?.file || form.get("resume");
    const previous = loadProfile();
    let resume: File;
    if (uploadedResume instanceof File) resume = uploadedResume;
    else if (previous && existsSync(previous.resumePath)) {
      const name = basename(previous.resumePath);
      resume = new File([readFileSync(previous.resumePath)], name, { type: extname(name).toLowerCase() === ".txt" ? "text/plain" : "application/pdf" });
    } else throw new Error("请先添加图片、TXT、PDF 或 Word 简历。");
    const confirmedRaw = form.get("confirmed");
    if (typeof confirmedRaw !== "string") throw new Error("Review and confirm the extracted profile first.");
    const confirmed = JSON.parse(confirmedRaw) as ConfirmedProfile;
    const name = stringValue(confirmed.fullName, 100);
    if (!name) throw new Error("Confirm your name before saving the profile.");
    const parsed = await readResume(resume);
    const archivedSupporting = archived?.entries.filter((entry) => entry.category !== "resume") || [];
    const supporting = archived ? archivedSupporting.map((entry) => entry.file) : form.getAll("document");
    const categories = archived ? archivedSupporting.map((entry) => entry.category) : form.getAll("category");
    const documentDetails = parseDocumentDetails(form.get("documentDetails"), supporting.length);
    const resumeTable = parseResumeTable(form.get("resumeTable"));
    if (supporting.length !== categories.length) throw new Error("Every supporting file needs a category.");
    const documents = supporting.map((value, index) => {
      const category = categories[index];
      if (!(value instanceof File) || typeof category !== "string" || !INTAKE_CATEGORIES.some((entry) => entry.id === category)) {
        throw new Error("Invalid supporting file or category.");
      }
      return { category: category as IntakeCategory, file: value, details: documentDetails[index] };
    });
    if (documents.some((item) => item.category === "identity") && form.get("identityConsent") !== "true") {
      throw new Error("Confirm that identity and visa documents may be stored locally for this profile.");
    }
    const manifest = archived || documents.length || uploadedResume instanceof File
      ? await saveIntake(resume, documents, archived?.personalSheet)
      : null;
    const previousManifestPath = `${INTAKE_ROOT}/current.json`;
    const previousManifest = !manifest && existsSync(previousManifestPath)
      ? JSON.parse(readFileSync(previousManifestPath, "utf8")) as IntakeManifest
      : null;
    const profile = profileFromResume(parsed, manifest?.resumePath || previous!.resumePath);
    if (previous) {
      profile.commonAnswers = previous.commonAnswers;
      profile.answerStyle = previous.answerStyle;
      profile.workAuthorization.authorizedCountries = previous.workAuthorization.authorizedCountries;
    }
    profile.candidate.fullName = name;
    profile.candidate.email = stringValue(confirmed.email, 150);
    profile.candidate.phone = stringValue(confirmed.phone, 50);
    profile.candidate.city = stringValue(confirmed.city);
    profile.candidate.country = stringValue(confirmed.country);
    profile.preferences.desiredSalary = stringValue(confirmed.desiredSalary);
    profile.preferences.earliestStartDate = stringValue(confirmed.earliestStartDate);
    profile.preferences.locationPreference = stringValue(confirmed.locationPreference);
    profile.workAuthorization.visaStatus = stringValue(confirmed.visaStatus);
    profile.workAuthorization.requiresSponsorship = confirmed.sponsorship === "yes" ? true : confirmed.sponsorship === "no" ? false : null;
    profile.applicationDetails = { gender: stringValue(confirmed.gender), hometown: stringValue(confirmed.hometown), birthDate: stringValue(confirmed.birthDate), workYears: stringValue(confirmed.workYears), desiredIndustry: stringValue(confirmed.desiredIndustry), desiredOccupation: stringValue(confirmed.desiredOccupation), desiredMonthlySalary: stringValue(confirmed.desiredMonthlySalary) };
    profile.resumeTable = resumeTable;
    const tableFacts = tableFactsFor(resumeTable);
    const oldTableFacts = new Set(tableFactsFor(previous?.resumeTable || {}));
    const retainedDocuments = manifest?.documents || previousManifest?.documents || [];
    const documentFacts = retainedDocuments.map(({ category, details }) => `${INTAKE_CATEGORIES.find((entry) => entry.id === category)?.label || category}: ${[details?.title, details?.scoreOrResult, details?.issuedAt && `取得日期 ${details.issuedAt}`, details?.issuer, details?.notes].filter(Boolean).join("；")}`).filter((value) => !value.endsWith(": "));
    profile.facts = [...new Set([...profile.facts, ...(manifest ? [] : (previous?.facts || []).filter((fact) => !oldTableFacts.has(fact))), ...tableFacts, ...documentFacts])];
    saveProfile(profile);
    return NextResponse.json({ ready: true, candidateName: name, documentCount: retainedDocuments.length });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to save profile." }, { status: 400 });
  }
}
