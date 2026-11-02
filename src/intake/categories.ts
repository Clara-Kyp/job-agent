export const INTAKE_CATEGORIES = [
  { id: "education", label: "教育与成绩", hint: "学历学位、在读证明、学籍验证、成绩单", recommended: true },
  { id: "employment", label: "工作与实习", hint: "工作证明、离职证明；劳动合同仅在需要时提供", recommended: true },
  { id: "language", label: "语言与资格证书", hint: "雅思、英语四六级、职业资格证书", recommended: true },
  { id: "achievements", label: "项目与成果", hint: "作品集、获奖、论文、专利", recommended: false },
  { id: "identity", label: "证件与签证", hint: "身份证、护照、签证；仅在具体岗位需要时添加", recommended: false },
] as const;

export type IntakeCategory = (typeof INTAKE_CATEGORIES)[number]["id"];

export const INTAKE_EXTENSIONS = new Set([".pdf", ".txt", ".doc", ".docx", ".jpg", ".jpeg", ".png", ".xlsx"]);

export const INTAKE_MAX_FILE_BYTES = 15 * 1024 * 1024;
export const INTAKE_MAX_FILES = 30;
