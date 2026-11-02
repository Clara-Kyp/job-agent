import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PERSONAL_SHEET_NAME } from "./personal-sheet.js";
import { extname, basename } from "node:path";
import { unzipSync, zipSync, strToU8 } from "fflate";
import { INTAKE_EXTENSIONS, INTAKE_MAX_FILES, type IntakeCategory } from "./categories.js";
import { validateIntakeFile } from "./local-store.js";

export type ArchiveEntry = { path: string; category: IntakeCategory | "resume"; file: File };
const folders: Record<string, IntakeCategory | "resume"> = {
  "01_简历": "resume", "02_教育与成绩": "education", "03_工作与实习": "employment",
  "04_语言与资格证书": "language", "05_项目与成果": "achievements", "06_证件与签证": "identity",
};
const hints: Array<[RegExp, IntakeCategory | "resume"]> = [
  [/简历|resume|cv/i, "resume"], [/学籍|学历|学位|成绩单|在读|毕业|教育|transcript|degree/i, "education"],
  [/工作|实习|离职|劳动|employment|intern/i, "employment"], [/雅思|托福|六级|四级|证书|资格|ielts|toefl|cet/i, "language"],
  [/项目|论文|专利|获奖|作品|project|paper|award/i, "achievements"], [/身份证|护照|签证|passport|visa/i, "identity"],
];
function decodeZipPath(path: string): string {
  // Some macOS ZIP writers store UTF-8 filename bytes without setting the UTF-8 flag.
  // fflate then returns those bytes as Latin-1 characters; recover only on an exact round trip.
  const bytes = Buffer.from(path, "latin1");
  const recovered = bytes.toString("utf8");
  return (Buffer.from(recovered, "utf8").equals(bytes) ? recovered : path).normalize("NFC");
}
export function makeTemplateZip(): Uint8Array {
  const guide = `Job Agent 资料包模板\n\n1. 先填写根目录的“个人信息表.xlsx”，不要修改工作表名和表头；再将真实证明文件放入对应文件夹。\n2. 简历文件夹必须且只能有一份简历。支持 JPG/PNG、TXT、PDF、DOC/DOCX；其他 XLSX 证明文件可保存，但暂不自动解析。\n3. 文件名建议写清材料名称、机构、日期或成绩，例如 雅思_2026-03_6.5.pdf、论文_题目_第一作者.pdf。\n4. 可以删掉不用的文件夹；不要放银行卡、密码等无关资料。\n5. 上传 ZIP 后个人信息表自动填入基本信息和简历表格；证明文件按文件夹优先、文件名其次分类解析。所有结果都需要本人核对。\n6. 证件与签证文件只有勾选本机保存确认后才会保存；不会自动上传招聘网站。\n`;
  const entries: Record<string, Uint8Array> = { "使用说明.txt": strToU8(guide), [PERSONAL_SHEET_NAME]: new Uint8Array(readFileSync(resolve(process.cwd(), "public/templates/job-agent-personal-profile.xlsx"))) };
  for (const name of Object.keys(folders)) entries[`${name}/.keep`] = new Uint8Array();
  return zipSync(entries, { level: 6 });
}
export async function readArchive(archive: File): Promise<{ entries: ArchiveEntry[]; personalSheet: File; warnings: string[] }> {
  if (!/\.zip$/i.test(archive.name) || !archive.size || archive.size > 50 * 1024 * 1024) throw new Error("请上传不超过 50 MB 的 ZIP 资料包。");
  const bytes = new Uint8Array(await archive.arrayBuffer());
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new Error("文件不是有效的 ZIP 资料包。");
  let declaredTotal = 0, declaredCount = 0;
  const raw = unzipSync(bytes, { filter: (info) => {
    declaredCount++; declaredTotal += info.originalSize;
    if (declaredCount > 120 || declaredTotal > 80 * 1024 * 1024 || info.originalSize > 15 * 1024 * 1024) throw new Error("资料包解压后超出文件数量或大小限制。");
    return true;
  } });
  const paths = Object.keys(raw).map((originalPath) => ({ originalPath, path: decodeZipPath(originalPath) }));
  const contentPaths = paths.map(({ path }) => path).filter((path) => !path.endsWith("/") && !path.split("/").some((part) => part === "__MACOSX" || part.startsWith(".")));
  const sheetPaths = contentPaths.filter((path) => basename(path).normalize("NFC") === PERSONAL_SHEET_NAME);
  if (sheetPaths.length > 1) throw new Error(`资料包内有 ${sheetPaths.length} 份 ${PERSONAL_SHEET_NAME}，请只保留一份。`);
  const wrapper = sheetPaths.length === 1 && sheetPaths[0] !== PERSONAL_SHEET_NAME && sheetPaths[0].split("/").length === 2
    ? sheetPaths[0].split("/")[0] : "";
  if (wrapper && contentPaths.some((path) => !path.startsWith(`${wrapper}/`))) {
    throw new Error(`个人信息表位于“${wrapper}”文件夹，但其他资料散落在文件夹外。请把全部资料放入同一文件夹后重新压缩。`);
  }
  const entries: ArchiveEntry[] = [], warnings: string[] = [];
  if (wrapper) warnings.push(`已自动识别 ZIP 外层文件夹“${wrapper}”，按文件夹内的资料包解析。`);
  let personalSheet: File | null = null;
  let total = 0;
  for (const entry of paths) {
    const { originalPath } = entry;
    if (entry.path.split("/").some((part) => part === "..") || entry.path.startsWith("/") || entry.path.includes("\\")) throw new Error(`资料包包含不安全路径：${entry.path}`);
    const path = wrapper && entry.path.startsWith(`${wrapper}/`) ? entry.path.slice(wrapper.length + 1) : entry.path;
    const parts = path.split("/");
    if (!path || entry.path.endsWith("/") || parts.some((part) => part === "__MACOSX") || basename(path).startsWith(".") || basename(path) === "使用说明.txt") continue;
    const data = raw[originalPath]; total += data.byteLength;
    if (total > 80 * 1024 * 1024) throw new Error("解压后文件总量超过 80 MB。");
    const filename = basename(path).normalize("NFC");
    if (filename === PERSONAL_SHEET_NAME) {
      if (path.normalize("NFC") !== PERSONAL_SHEET_NAME || personalSheet) throw new Error("个人信息表必须且只能在资料包根目录放一份。");
      personalSheet = new File([Buffer.from(data)], filename);
      continue;
    }
    if (!INTAKE_EXTENSIONS.has(extname(filename).toLowerCase())) { warnings.push(`${path}：格式暂不支持，已跳过`); continue; }
    const category = folders[parts[0]] || hints.find(([pattern]) => pattern.test(filename))?.[1];
    if (!category) { warnings.push(`${path}：无法根据目录或文件名分类，已跳过`); continue; }
    const file = new File([Buffer.from(data)], filename);
    validateIntakeFile(file, category === "resume");
    entries.push({ path, category, file });
  }
  if (!personalSheet) throw new Error(`资料包缺少 ${PERSONAL_SHEET_NAME}。请下载并填写最新版模板。`);
  if (entries.length > INTAKE_MAX_FILES + 1) throw new Error(`最多上传 ${INTAKE_MAX_FILES} 份证明文件和 1 份简历。`);
  const resumes = entries.filter((entry) => entry.category === "resume");
  if (resumes.length !== 1) throw new Error(`资料包必须且只能有 1 份简历，目前识别到 ${resumes.length} 份。`);
  return { entries, personalSheet, warnings };
}
