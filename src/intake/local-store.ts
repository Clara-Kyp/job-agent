import { randomUUID } from "node:crypto";
import { chmodSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { INTAKE_CATEGORIES, INTAKE_EXTENSIONS, INTAKE_MAX_FILE_BYTES, INTAKE_MAX_FILES, type IntakeCategory } from "./categories.js";
import type { DocumentDetails } from "./structured-profile.js";

export const INTAKE_ROOT = resolve(process.cwd(), "data/private/intake");

export interface IntakeDocument {
  category: IntakeCategory;
  originalName: string;
  storedPath: string;
  bytes: number;
  details?: DocumentDetails;
}

export interface IntakeManifest {
  version: 1;
  createdAt: string;
  resumePath: string;
  personalSheetPath?: string;
  documents: IntakeDocument[];
}

export function checkLocalRequest(request: Request): void {
  const hostname = new URL(request.url).hostname;
  if (hostname !== "localhost" && hostname !== "127.0.0.1") {
    throw new Error("Profile intake is available only on the user's local computer.");
  }
  const origin = request.headers.get("origin");
  if (origin) {
    const source = new URL(origin);
    const destination = new URL(request.url);
    const loopback = (host: string) => host === "localhost" || host === "127.0.0.1";
    if (!loopback(source.hostname) || source.port !== destination.port || source.protocol !== destination.protocol) {
      throw new Error("Cross-origin profile intake is not allowed.");
    }
  }
}

export function validateIntakeFile(file: File, resume = false): string {
  const ext = extname(file.name).toLowerCase();
  if (!INTAKE_EXTENSIONS.has(ext) || (resume && ![".pdf", ".txt", ".doc", ".docx", ".jpg", ".jpeg", ".png"].includes(ext))) {
    throw new Error(resume ? "简历支持图片、TXT、PDF 或 Word 文件。" : `Unsupported file: ${file.name}`);
  }
  if (file.size === 0 || file.size > (resume ? 10 * 1024 * 1024 : INTAKE_MAX_FILE_BYTES)) {
    throw new Error(`File is empty or too large: ${file.name}`);
  }
  return ext;
}

export async function saveIntake(resume: File, files: Array<{ category: IntakeCategory; file: File; details?: DocumentDetails }>, personalSheet?: File): Promise<IntakeManifest> {
  if (files.length > INTAKE_MAX_FILES) throw new Error(`Choose no more than ${INTAKE_MAX_FILES} supporting files.`);
  const resumeExt = validateIntakeFile(resume, true);
  for (const item of files) {
    if (!INTAKE_CATEGORIES.some((category) => category.id === item.category)) throw new Error("Invalid document category.");
    validateIntakeFile(item.file);
  }
  const directory = join(INTAKE_ROOT, randomUUID());
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
  const resumePath = join(directory, `resume${resumeExt}`);
  writeFileSync(resumePath, Buffer.from(await resume.arrayBuffer()), { mode: 0o600 });
  const personalSheetPath = personalSheet ? join(directory, "personal-profile.xlsx") : undefined;
  if (personalSheet && personalSheetPath) writeFileSync(personalSheetPath, Buffer.from(await personalSheet.arrayBuffer()), { mode: 0o600 });
  const documents: IntakeDocument[] = [];
  for (const { category, file, details } of files) {
    const storedPath = join(directory, `${randomUUID()}${extname(file.name).toLowerCase()}`);
    writeFileSync(storedPath, Buffer.from(await file.arrayBuffer()), { mode: 0o600 });
    documents.push({ category, originalName: file.name, storedPath, bytes: file.size, details });
  }
  const manifest: IntakeManifest = { version: 1, createdAt: new Date().toISOString(), resumePath, personalSheetPath, documents };
  mkdirSync(INTAKE_ROOT, { recursive: true, mode: 0o700 });
  const temporaryPath = join(INTAKE_ROOT, `current-${randomUUID()}.json`);
  writeFileSync(temporaryPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporaryPath, join(INTAKE_ROOT, "current.json"));
  return manifest;
}
