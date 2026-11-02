import { parseResumeText } from "../evaluator/resume-parser.js";
import { readIntakeText } from "./read-file.js";

export async function readResume(file: File) {
  const text = await readIntakeText(file, true);
  if (!text) throw new Error("未能从简历中识别文字，请换一份清晰的图片、TXT、PDF 或 Word 文件。");
  return parseResumeText(text);
}
