"use client";

import { useState } from "react";
import { INTAKE_CATEGORIES, type IntakeCategory } from "../intake/categories";
import { EMPTY_DOCUMENT_DETAILS, RESUME_SECTIONS, type DocumentDetails, type ResumeSectionId, type ResumeTable } from "../intake/structured-profile";

type Confirmed = {
  fullName: string; email: string; phone: string; city: string; country: string;
  desiredSalary: string; earliestStartDate: string; locationPreference: string;
  visaStatus: string; sponsorship: "yes" | "no" | "unknown";
  gender: string; hometown: string; birthDate: string; workYears: string; desiredIndustry: string; desiredOccupation: string; desiredMonthlySalary: string;
};

const empty: Confirmed = {
  fullName: "", email: "", phone: "", city: "", country: "",
  desiredSalary: "", earliestStartDate: "", locationPreference: "",
  visaStatus: "", sponsorship: "unknown",
  gender: "", hometown: "", birthDate: "", workYears: "", desiredIndustry: "", desiredOccupation: "", desiredMonthlySalary: "",
};

export function ProfileOnboarding({ onSaved, onCancel, existing, initialMode = "edit", initialConfirmed, initialResumeTable }: { onSaved: (name: string) => void; onCancel?: () => void; existing: boolean; initialMode?: "edit" | "upload"; initialConfirmed?: Confirmed | null; initialResumeTable?: ResumeTable | null }) {
  const [archive, setArchive] = useState<File | null>(null);
  const [inventory, setInventory] = useState<Array<{ path: string; category: IntakeCategory | "resume"; details: DocumentDetails | null; preview: string }>>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [resumeTable, setResumeTable] = useState<ResumeTable>(initialResumeTable || {});
  const [confirmed, setConfirmed] = useState<Confirmed>(initialConfirmed || empty);
  const [stage, setStage] = useState<"files" | "review">(existing && initialMode === "edit" ? "review" : "files");
  const [identityConsent, setIdentityConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [counts, setCounts] = useState<{ education: number; experience: number; skills: number } | null>(null);
  const [aiSections, setAiSections] = useState<Partial<Record<ResumeSectionId, boolean>>>({});
  const [polish, setPolish] = useState<{ section: ResumeSectionId; rowIndex: number; instruction: string; draft: string } | null>(null);
  const [polishBusy, setPolishBusy] = useState(false);
  const [polishError, setPolishError] = useState("");
  const [suggestionMessage, setSuggestionMessage] = useState("");

  async function suggestFromSavedResume() {
    setBusy(true); setError(""); setSuggestionMessage("");
    try {
      const response = await fetch("/api/profile/resume-suggestions");
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "无法读取已保存简历。");
      const suggestions = result.suggestions as ResumeTable;
      const adopted: string[] = [];
      const next = { ...resumeTable };
      for (const section of RESUME_SECTIONS) {
        const rows = suggestions[section.id] || [];
        if (!(resumeTable[section.id] || []).some((row) => row.some(Boolean)) && rows.length) {
          next[section.id] = rows;
          adopted.push(section.title);
        }
      }
      setResumeTable(next);
      setSuggestionMessage(adopted.length ? `已从 ${result.resumeName} 生成${adopted.join("、")}建议。请核对每个字段，尤其是日期；确认后再保存。` : "简历没有解析出可补充的表格行。请按原件手工填写。现有内容未被覆盖。");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "解析失败。"); }
    finally { setBusy(false); }
  }

  async function selectArchive(file: File | null) {
    setArchive(file); setInventory([]); setWarnings([]); setCounts(null); setError("");
    if (!file) return;
    setBusy(true);
    try {
      const body = new FormData(); body.set("archive", file);
      const response = await fetch("/api/profile/archive/preview", { method: "POST", body });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "资料包解析失败。");
      setInventory(result.inventory); setWarnings(result.warnings || []); setCounts(result.facts);
      setConfirmed(result.candidate as Confirmed);
      setResumeTable(result.resumeTable as ResumeTable);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "解析失败。"); }
    finally { setBusy(false); }
  }

  async function generatePolish() {
    if (!polish) return;
    setPolishBusy(true); setPolishError("");
    try {
      const response = await fetch("/api/profile/polish", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ section: polish.section, row: resumeTable[polish.section]?.[polish.rowIndex] || [], instruction: polish.instruction, previousDraft: polish.draft }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || "生成失败。");
      setPolish((current) => current ? { ...current, draft: result.draft } : null);
    } catch (cause) { setPolishError(cause instanceof Error ? cause.message : "生成失败。"); }
    finally { setPolishBusy(false); }
  }

  async function save() {
    if (!archive && !existing) return;
    setBusy(true); setError("");
    try {
      const body = new FormData();
      if (archive) body.set("archive", archive);
      body.set("confirmed", JSON.stringify(confirmed));
      body.set("resumeTable", JSON.stringify(resumeTable));
      body.set("identityConsent", String(identityConsent));
      const details: DocumentDetails[] = inventory.filter((item) => item.category !== "resume").map((item) => item.details || EMPTY_DOCUMENT_DETAILS);
      body.set("documentDetails", JSON.stringify(details));
      const response = await fetch("/api/profile", { method: "POST", body });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not save profile.");
      onSaved(result.candidateName);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Save failed."); }
    finally { setBusy(false); }
  }

  function update<K extends keyof Confirmed>(key: K, value: Confirmed[K]) {
    setConfirmed((current) => ({ ...current, [key]: value }));
  }

  function updateTable(section: ResumeSectionId, rowIndex: number, cellIndex: number, value: string) {
    setResumeTable((current) => {
      const rows = (current[section] || []).map((row) => [...row]);
      rows[rowIndex][cellIndex] = value;
      return { ...current, [section]: rows };
    });
  }

  function addRow(section: (typeof RESUME_SECTIONS)[number]) {
    setResumeTable((current) => ({ ...current, [section.id]: [...(current[section.id] || []), section.columns.map(() => "")] }));
  }

  function updateInventory(index: number, key: keyof DocumentDetails, value: string) {
    setInventory((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, details: { ...(item.details || EMPTY_DOCUMENT_DETAILS), [key]: value } } : item));
  }

  const field = (label: string, key: keyof Confirmed, placeholder = "可留空，之后再补充") => (
    <label className="block text-xs font-bold text-[#546259]" key={key}>
      {label}
      <input value={confirmed[key]} onChange={(event) => update(key, event.target.value as never)} placeholder={placeholder}
        className="mt-2 w-full rounded-xl border border-[#dce5dc] bg-white px-3 py-3 text-sm outline-none focus:border-[#66bd8a]" />
    </label>
  );

  return (
    <section className="rounded-3xl border border-[#dce5dc] bg-[#fbfcf8]/90 p-5 shadow-[0_18px_60px_rgba(67,93,73,0.08)] sm:p-7">
      <p className="text-xs font-extrabold uppercase tracking-[0.14em] text-[#43976b]">{existing ? "个人档案 · 编辑" : "Step 1 · 首次建档"}</p>
      <h2 className="mt-2 text-2xl font-extrabold tracking-tight">{existing ? stage === "files" ? "重新上传资料包" : "编辑已保存档案" : "先上传资料，以后只贴职位链接"}</h2>
      <p className="mt-2 text-sm leading-6 text-[#66736c]">{existing ? stage === "files" ? "选择新的完整资料包，解析并核对后再保存。现有档案会保留到你确认保存新内容。" : "直接修改下方基本信息和经历表格，保存后立即更新本机档案；也可以改用重新上传资料包。" : "下载资料包模板，填写其中的“个人信息表.xlsx”，再按文件夹放入证明材料；上传一个 ZIP 后，基本信息和简历表格会自动填入页面。资料保存在这台电脑；证明文件不会因建档自动上传给招聘网站。"}</p>

      {stage === "files" ? <div className="mt-6 space-y-5">
        <div className="flex flex-wrap gap-3"><a href="/api/profile/template" download className="inline-flex rounded-xl border border-[#246f4b] px-4 py-3 text-sm font-bold text-[#246f4b]">下载资料包模板 ZIP</a><a href="/templates/job-agent-personal-profile.xlsx" download="个人信息表.xlsx" className="inline-flex rounded-xl border border-[#dce5dc] px-4 py-3 text-sm font-bold text-[#246f4b]">单独下载个人信息表</a></div>
        <p className="text-xs leading-5 text-[#66736c]">解压模板，先填写根目录的个人信息表，再把真实材料放入对应文件夹，重新压缩后一次上传。按文件夹优先、文件名其次分流；简历必须有且仅有一份。支持图片、TXT、PDF、Word；个人信息表 XLSX 可自动解析。</p>
        <label className="block text-xs font-bold text-[#546259]">上传完整资料包 ZIP
          <input type="file" accept=".zip,application/zip" onChange={(event) => void selectArchive(event.target.files?.[0] || null)} className="mt-2 block w-full rounded-xl border border-[#dce5dc] bg-white px-3 py-3 text-sm" />
        </label>
        {busy && <p className="text-sm text-[#3d9366]">正在分类并解析资料包…</p>}
        {inventory.length > 0 && <div className="space-y-3"><h3 className="font-bold">文件内容与解析结果（{inventory.length} 份）</h3>
          {inventory.map((item) => <div key={item.path} className="rounded-xl border border-[#dce5dc] bg-white p-3 text-xs leading-5">
            <p className="font-bold text-[#246f4b]">{item.path}</p><p className="text-[#66736c]">{item.category === "resume" ? "简历" : INTAKE_CATEGORIES.find((category) => category.id === item.category)?.label}</p>
            {item.details && <p className="mt-1">{[item.details.title, item.details.issuedAt, item.details.issuer, item.details.scoreOrResult, item.details.notes].filter(Boolean).join(" · ") || "未提取到结构化信息"}</p>}
            <p className="mt-1 whitespace-pre-wrap text-[#849087]">{item.preview || "未识别到文字；请检查文件"}</p>
          </div>)}
        </div>}
        {warnings.length > 0 && <div className="rounded-xl bg-[#fff5e7] p-3 text-xs text-[#8b6c57]">{warnings.map((warning) => <p key={warning}>{warning}</p>)}</div>}
        {inventory.some((item) => item.category === "identity") && <label className="flex items-start gap-2 text-xs leading-5 text-[#546259]"><input type="checkbox" checked={identityConsent} onChange={(event) => setIdentityConsent(event.target.checked)} className="mt-1" />资料包包含证件／签证文件。我允许 Job Agent 将这些文件保存在本机；不会自动上传给招聘网站。</label>}
        <button disabled={!counts || busy || Boolean(inventory.some((item) => item.category === "identity") && !identityConsent)} onClick={() => setStage("review")} className="w-full rounded-xl bg-[#17211d] px-4 py-3 text-sm font-bold text-white disabled:opacity-40">核对解析结果</button>
        {existing && <button type="button" onClick={() => setStage("review")} className="w-full rounded-xl border border-[#17211d] px-4 py-3 text-sm font-bold">返回档案编辑</button>}
      </div> : <div className="mt-6 space-y-5">
        <p className="rounded-xl bg-[#eaf8ee] p-3 text-xs text-[#3b7353]">{counts ? `个人信息表已自动填入下方内容；简历另识别到 ${counts.education} 段教育、${counts.experience} 段经历、${counts.skills} 项技能。` : "正在编辑已保存的档案。"} 请核对基本信息；证明文件中的信息以你填写和确认的内容为准。</p>
        <div className="grid gap-4 sm:grid-cols-2">
          {field("姓名（必填）", "fullName", "请输入真实姓名")}
          {field("邮箱", "email")}
          {field("手机号", "phone")}
          {field("当前城市", "city")}
          {field("国家或地区", "country")}
          {field("求职意向地", "locationPreference")}
          {field("期望薪资（注明币种和周期）", "desiredSalary")}
          {field("最早到岗时间", "earliestStartDate")}
          {field("签证或工作许可状态", "visaStatus")}
          {field("性别", "gender")}{field("籍贯", "hometown")}{field("出生日期（YYYY-MM-DD）", "birthDate")}{field("工作年限", "workYears")}{field("期望从事行业", "desiredIndustry")}{field("期望从事职业", "desiredOccupation")}{field("期望税前月薪（人民币）", "desiredMonthlySalary")}
          <label className="block text-xs font-bold text-[#546259]">是否需要雇主签证担保
            <select value={confirmed.sponsorship} onChange={(event) => update("sponsorship", event.target.value as Confirmed["sponsorship"])}
              className="mt-2 w-full rounded-xl border border-[#dce5dc] bg-white px-3 py-3 text-sm">
              <option value="unknown">未知 / 按地区判断</option><option value="no">不需要</option><option value="yes">需要</option>
            </select>
          </label>
        </div>
        <div className="space-y-5">
          <div><h3 className="text-lg font-bold">简历信息表格模板</h3><p className="mt-1 text-xs text-[#66736c]">个人信息表和简历解析结果仅供参考，可在这里核对修改。没有的部分留空，不要补造。</p>{existing && <button type="button" disabled={busy} onClick={() => void suggestFromSavedResume()} className="mt-3 rounded-xl border border-[#246f4b] px-3 py-2 text-xs font-bold text-[#246f4b] disabled:opacity-40">从已保存简历补充空白表格</button>}{suggestionMessage && <p className="mt-2 rounded-xl bg-[#fff3df] p-3 text-xs text-[#825b26]">{suggestionMessage}</p>}</div>
          {RESUME_SECTIONS.map((section) => <div key={section.id} className="rounded-2xl border border-[#dce5dc] bg-white p-4">
            <div className="flex items-center justify-between gap-3"><h4 className="text-sm font-bold">{section.title}</h4><div className="flex items-center gap-3">{["employment", "projects", "publications", "awards"].includes(section.id) && <label className="flex items-center gap-1 text-xs text-[#246f4b]"><input type="checkbox" checked={Boolean(aiSections[section.id])} onChange={(event) => setAiSections((current) => ({ ...current, [section.id]: event.target.checked }))} />AI 润色</label>}<button type="button" onClick={() => addRow(section)} className="text-xs font-bold text-[#246f4b]">＋ 添加一行</button></div></div>
            {(resumeTable[section.id] || []).length ? <div className="mt-3 overflow-x-auto"><table className="w-full min-w-[650px] border-collapse text-xs"><thead><tr>{section.columns.map((column) => <th key={column} className="border-b border-[#dce5dc] p-2 text-left font-semibold">{column}</th>)}<th className="border-b border-[#dce5dc] p-2">操作</th></tr></thead><tbody>{(resumeTable[section.id] || []).map((row, rowIndex) => <tr key={rowIndex}>{section.columns.map((column, cellIndex) => <td key={column} className="p-1"><input aria-label={`${section.title}第${rowIndex + 1}行${column}`} value={row[cellIndex] || ""} onChange={(event) => updateTable(section.id, rowIndex, cellIndex, event.target.value)} className="w-full min-w-[110px] rounded-lg border border-[#dce5dc] px-2 py-2" /></td>)}<td className="p-1">{aiSections[section.id] && <button type="button" onClick={() => { setPolish({ section: section.id, rowIndex, instruction: "", draft: "" }); setPolishError(""); }} className="mr-2 text-[#246f4b]">润色</button>}<button type="button" onClick={() => setResumeTable((current) => ({ ...current, [section.id]: (current[section.id] || []).filter((_, index) => index !== rowIndex) }))} className="text-[#b64c38]">删除</button></td></tr>)}</tbody></table></div> : <p className="mt-3 text-xs text-[#849087]">暂无记录，可按需添加。</p>}
          </div>)}
        </div>
        {inventory.some((item) => item.category !== "resume" && item.category !== "identity") && <div className="space-y-3"><h3 className="font-bold">证明材料信息核对</h3><p className="text-xs text-[#66736c]">自动识别仅作参考。日期、成绩、论文状态和作者顺序请按原件修正。</p>{inventory.map((item, index) => item.details && <div key={item.path} className="rounded-xl border border-[#dce5dc] bg-white p-3"><p className="mb-2 text-xs font-bold text-[#246f4b]">{item.path}</p><div className="grid gap-2 sm:grid-cols-2">{([ ["title", "材料名称 / 考试名称"], ["issuedAt", "取得 / 发表日期"], ["issuer", "机构 / 期刊 / 会议"], ["scoreOrResult", "成绩 / 等级 / 作者顺序"], ["expiresAt", "有效期至"], ["notes", "状态 / DOI / 补充说明"] ] as const).map(([key, label]) => <label key={key} className="text-xs text-[#546259]">{label}<input value={item.details?.[key] || ""} onChange={(event) => updateInventory(index, key, event.target.value)} className="mt-1 w-full rounded-lg border border-[#dce5dc] px-2 py-2" /></label>)}</div></div>)}</div>}
        <p className="text-xs text-[#849087]">不确定的字段可留空。之后遇到对应申请表时再询问，不会自行编造。</p>
        <div className="flex flex-wrap gap-3">{existing && !archive ? <><button type="button" onClick={onCancel} className="rounded-xl border border-[#dce5dc] px-4 py-3 text-sm font-bold">取消编辑</button><button type="button" onClick={() => setStage("files")} className="rounded-xl border border-[#dce5dc] px-4 py-3 text-sm font-bold">更换简历或新增材料</button></> : <button type="button" onClick={() => setStage("files")} className="rounded-xl border border-[#dce5dc] px-4 py-3 text-sm font-bold">返回资料包</button>}
          <button disabled={!confirmed.fullName.trim() || busy} onClick={save} className="flex-1 rounded-xl bg-[#17211d] px-4 py-3 text-sm font-bold text-white disabled:opacity-40">{busy ? "正在保存…" : existing ? "确认并更新本机档案" : "确认并保存本机档案"}</button>
        </div>
      </div>}
      {polish && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"><div role="dialog" aria-modal="true" aria-label="AI 润色对话框" className="w-full max-w-xl rounded-2xl bg-white p-5 shadow-2xl">
        <h3 className="font-bold">AI 润色 · {RESUME_SECTIONS.find((section) => section.id === polish.section)?.title}</h3>
        <p className="mt-2 text-xs text-[#66736c]">原始内容：{(resumeTable[polish.section]?.[polish.rowIndex] || []).join(" · ")}</p>
        <label className="mt-3 block text-xs font-bold">告诉模型如何修改<textarea value={polish.instruction} onChange={(event) => setPolish({ ...polish, instruction: event.target.value })} placeholder="例如：突出协作经历，但不要增加新事实" className="mt-2 w-full rounded-lg border p-3 text-sm" rows={3} /></label>
        {polish.draft && <label className="mt-3 block text-xs font-bold">生成草稿（可直接编辑）<textarea value={polish.draft} onChange={(event) => setPolish({ ...polish, draft: event.target.value })} className="mt-2 w-full rounded-lg border p-3 text-sm" rows={5} /></label>}
        {polishError && <p role="alert" className="mt-2 text-xs text-[#b64c38]">{polishError}</p>}
        <p className="mt-2 text-xs text-[#8b6c57]">模型建议可能有误。请核对事实，点击“应用”后才会写入表格。</p>
        <div className="mt-4 flex flex-wrap justify-end gap-2"><button type="button" onClick={() => setPolish(null)} className="rounded-lg border px-3 py-2 text-sm">取消</button><button type="button" disabled={polishBusy} onClick={() => void generatePolish()} className="rounded-lg border px-3 py-2 text-sm">{polishBusy ? "生成中…" : polish.draft ? "按要求重新生成" : "生成建议"}</button><button type="button" disabled={!polish.draft} onClick={() => { const section = RESUME_SECTIONS.find((item) => item.id === polish.section)!; const index = section.id === "publications" ? 5 : 4; updateTable(polish.section, polish.rowIndex, index, polish.draft); setPolish(null); }} className="rounded-lg bg-[#17211d] px-3 py-2 text-sm text-white disabled:opacity-40">应用到当前行</button></div>
      </div></div>}
      {error && <p role="alert" className="mt-4 text-sm font-semibold text-[#b64c38]">{error}</p>}
    </section>
  );
}
