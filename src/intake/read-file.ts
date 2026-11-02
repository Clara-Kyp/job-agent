import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";
import { promisify } from "node:util";
import mammoth from "mammoth";
import { extractText, getDocumentProxy } from "unpdf";
import { validateIntakeFile } from "./local-store.js";

const run = promisify(execFile);
const OCR_SCRIPT = resolve(process.cwd(), "src/intake/ocr.swift");
const MAX_TEXT_CHARS = 100_000;

async function withTemporaryFile<T>(file: File, action: (path: string) => Promise<T>): Promise<T> {
  const directory = await mkdtemp(join(tmpdir(), "job-agent-parse-"));
  const path = join(directory, `input${extname(file.name).toLowerCase()}`);
  try {
    await writeFile(path, Buffer.from(await file.arrayBuffer()), { mode: 0o600 });
    return await action(path);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function ocr(file: File): Promise<string> {
  if (process.platform !== "darwin") throw new Error("图片和扫描件识别目前需要 macOS。");
  return withTemporaryFile(file, async (path) => {
    const { stdout } = await run("/usr/bin/swift", [OCR_SCRIPT, path], {
      timeout: 120_000,
      maxBuffer: 8 * 1024 * 1024,
    });
    return stdout;
  });
}

export async function readIntakeText(file: File, resume = false): Promise<string> {
  const ext = validateIntakeFile(file, resume);
  const bytes = new Uint8Array(await file.arrayBuffer());
  let text = "";
  if (ext === ".txt") text = new TextDecoder("utf-8").decode(bytes);
  else if (ext === ".docx") {
    const result = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
    text = result.value;
  } else if (ext === ".doc") {
    if (process.platform !== "darwin") throw new Error("旧版 .doc 文件目前需要 macOS 转换。");
    text = await withTemporaryFile(file, async (path) => {
      const { stdout } = await run("/usr/bin/textutil", ["-convert", "txt", "-stdout", path], {
        timeout: 30_000,
        maxBuffer: 8 * 1024 * 1024,
      });
      return stdout;
    });
  } else if (ext === ".pdf") {
    try {
      text = (await extractText(await getDocumentProxy(bytes.slice()), { mergePages: true })).text;
    } catch {
      text = "";
    }
    if (text.trim().length < 40) text = await ocr(file);
  } else if (ext === ".jpg" || ext === ".jpeg" || ext === ".png") text = await ocr(file);
  else throw new Error("该文件格式可保存为证明，但暂不支持自动解析。");
  return text.slice(0, MAX_TEXT_CHARS).trim();
}
