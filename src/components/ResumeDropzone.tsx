"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Check, FileText, UploadCloud, X } from "lucide-react";
import { useRef, useState } from "react";

interface ResumeDropzoneProps {
  file: File | null;
  onFileChange: (file: File | null) => void;
}

export function ResumeDropzone({ file, onFileChange }: ResumeDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");

  function acceptFile(candidate?: File) {
    if (!candidate) return;
    const isPdf = candidate.type === "application/pdf" || candidate.name.toLowerCase().endsWith(".pdf");
    const isText = candidate.type === "text/plain" || candidate.name.toLowerCase().endsWith(".txt");
    if (!isPdf && !isText) {
      setError("Choose a PDF resume, or a TXT resume for the local demo.");
      return;
    }
    if (candidate.size > 10 * 1024 * 1024) {
      setError("Keep your resume under 10 MB.");
      return;
    }
    setError("");
    onFileChange(candidate);
  }

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") inputRef.current?.click(); }}
        onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => { event.preventDefault(); setDragging(false); acceptFile(event.dataTransfer.files[0]); }}
        className={`group relative flex min-h-48 cursor-pointer flex-col items-center justify-center overflow-hidden rounded-2xl border border-dashed p-6 text-center transition ${dragging ? "border-[#47c883] bg-[#e3f9eb]" : "border-[#cbd7cc] bg-white/60 hover:border-[#8eb5a0] hover:bg-white"}`}
      >
        <input ref={inputRef} type="file" accept="application/pdf,.pdf,text/plain,.txt" className="hidden" onChange={(event) => acceptFile(event.target.files?.[0])} />
        <AnimatePresence mode="wait">
          {file ? (
            <motion.div key="file" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="flex w-full items-center gap-3 text-left">
              <div className="grid size-12 shrink-0 place-items-center rounded-xl bg-[#d9f6e5] text-[#218153]"><FileText size={22} /></div>
              <div className="min-w-0 flex-1"><p className="truncate text-sm font-bold">{file.name}</p><p className="mt-1 text-xs text-[#718078]">{(file.size / 1024 / 1024).toFixed(2)} MB · {file.name.toLowerCase().endsWith(".txt") ? "Text resume" : "PDF ready"}</p></div>
              <button type="button" aria-label="Remove resume" onClick={(event) => { event.stopPropagation(); onFileChange(null); }} className="rounded-full p-2 text-[#718078] hover:bg-[#eff4ef] hover:text-[#17211d]"><X size={17} /></button>
            </motion.div>
          ) : (
            <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center">
              <div className="mb-4 grid size-12 place-items-center rounded-2xl bg-[#e9f7ed] text-[#2b9d68] transition group-hover:scale-105"><UploadCloud size={22} /></div>
              <p className="text-sm font-bold">Drop your resume here</p><p className="mt-1 text-xs text-[#718078]">or click to browse · PDF or TXT up to 10 MB</p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      {error && <p className="mt-2 text-xs font-semibold text-[#c14f42]">{error}</p>}
      {file && <p className="mt-2 flex items-center gap-1 text-xs font-semibold text-[#2c9564]"><Check size={13} /> Ready for extraction</p>}
    </div>
  );
}
