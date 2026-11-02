"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Check, Circle, LoaderCircle } from "lucide-react";

export type ExecutionStage = "queued" | "running" | "complete" | "error";
export interface ExecutionLog { id: string; text: string; stage: ExecutionStage; time: string; }

export function ExecutionConsole({ logs }: { logs: ExecutionLog[] }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-[#26352d] bg-[#18221d] shadow-[0_20px_50px_rgba(32,53,42,0.14)]">
      <div className="flex items-center justify-between border-b border-white/10 px-5 py-3"><div className="flex items-center gap-2"><span className="size-2 rounded-full bg-[#f27a62]" /><span className="size-2 rounded-full bg-[#f3c96b]" /><span className="size-2 rounded-full bg-[#62d99a]" /><span className="ml-2 font-mono text-[11px] uppercase tracking-[0.16em] text-[#a5b7aa]">agent session / live</span></div><span className="font-mono text-[10px] text-[#74877a]">JOB AGENT</span></div>
      <div className="console-scroll min-h-64 space-y-3 overflow-y-auto p-5 font-mono text-xs">
        <AnimatePresence initial={false}>{logs.map((log) => <motion.div key={log.id} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} className="flex gap-3"><span className="mt-0.5 shrink-0 text-[#607467]">{log.time}</span><span className={log.stage === "error" ? "text-[#ff9b86]" : log.stage === "complete" ? "text-[#b6efc9]" : "text-[#dbe8dd]"}>{log.stage === "complete" ? <Check className="mr-2 inline" size={13} /> : log.stage === "running" ? <LoaderCircle className="mr-2 inline animate-spin" size={13} /> : <Circle className="mr-2 inline" size={8} />}{log.text}</span></motion.div>)}</AnimatePresence>
        {!logs.length && <p className="text-[#728579]">等待职位链接…</p>}
      </div>
    </div>
  );
}
