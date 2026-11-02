export const RESUME_SECTIONS = [
  { id: "education", title: "教育经历", columns: ["学校", "学历 / 学位", "专业", "开始时间", "结束时间", "主修课程 / 成绩说明"] },
  { id: "employment", title: "工作 / 实习经历", columns: ["公司 / 机构", "职位", "开始时间", "结束时间", "工作内容与成果"] },
  { id: "projects", title: "项目经历", columns: ["项目名称", "担任角色", "开始时间", "结束时间", "工作内容与成果", "项目链接"] },
  { id: "publications", title: "论文 / 发表成果", columns: ["论文标题", "作者顺序 / 贡献", "期刊 / 会议 / 平台", "发表或录用日期", "DOI / 链接", "状态及说明"] },
  { id: "certifications", title: "语言 / 技能证书", columns: ["证书或考试名称", "成绩 / 等级", "取得日期", "有效期至", "颁发机构 / 备注"] },
  { id: "awards", title: "奖项 / 荣誉", columns: ["奖项名称", "颁发机构", "取得日期", "级别 / 名次", "说明"] },
  { id: "jobPreferences", title: "求职意向", columns: ["现从事行业", "现从事职业", "现工作城市", "现税前月薪", "期望从事行业", "期望从事职业", "期望工作城市", "期望税前月薪", "到岗时间"] },
  { id: "languageAbility", title: "语言能力", columns: ["语言类型", "掌握程度", "听说", "读写", "证书 / 成绩说明"] },
] as const;

export type ResumeSectionId = (typeof RESUME_SECTIONS)[number]["id"];
export type ResumeTable = Partial<Record<ResumeSectionId, string[][]>>;

export interface DocumentDetails {
  title: string;
  issuedAt: string;
  issuer: string;
  scoreOrResult: string;
  expiresAt: string;
  notes: string;
}

export const EMPTY_DOCUMENT_DETAILS: DocumentDetails = {
  title: "", issuedAt: "", issuer: "", scoreOrResult: "", expiresAt: "", notes: "",
};
