"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Check, ExternalLink, ShieldCheck, X } from "lucide-react";

interface VerificationData {
  jobUrl: string;
  company: string;
  title: string;
  evaluation: {
    score: number;
    recommendation: string;
    fitAnalysis: string;
    matchStrengths: string[];
    matchGaps: string[];
  };
  values: Array<{ label: string; value: string }>;
  answers: Array<{ label: string; answer: string }>;
}

export function HumanVerificationModal({
  data,
  onClose,
  onContinue,
}: {
  data: VerificationData | null;
  onClose: () => void;
  onContinue: () => void;
}) {
  return (
    <AnimatePresence>
      {data && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 grid place-items-center bg-[#132019]/50 p-4 backdrop-blur-sm"
        >
          <motion.div
            initial={{ opacity: 0, y: 18, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12 }}
            className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-3xl bg-[#fbfcf8] p-6 shadow-2xl sm:p-8"
          >
            <div className="flex items-start justify-between">
              <div>
                <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-[#e1f8e9] px-3 py-1.5 text-[11px] font-extrabold uppercase tracking-[0.12em] text-[#258055]">
                  <ShieldCheck size={14} /> Human review required
                </div>
                <h2 className="text-2xl font-extrabold tracking-[-0.04em]">
                  Your application is ready
                </h2>
                <p className="mt-1 text-sm text-[#6c7971]">
                  {data.title} at {data.company}
                </p>
              </div>
              <button
                aria-label="Close review"
                onClick={onClose}
                className="rounded-full p-2 text-[#718078] hover:bg-[#edf2ed]"
              >
                <X size={19} />
              </button>
            </div>
            <div className="mt-6 rounded-2xl border border-[#ccebd7] bg-[#effaf2] p-5">
              <div className="flex items-end justify-between gap-4">
                <div>
                  <p className="text-[10px] font-extrabold uppercase tracking-[0.12em] text-[#39865f]">
                    Compatibility test
                  </p>
                  <p className="mt-1 text-sm font-semibold text-[#536158]">
                    {data.evaluation.recommendation.replaceAll("_", " ")}
                  </p>
                </div>
                <p className="text-4xl font-extrabold tracking-[-0.06em] text-[#258055]">
                  {data.evaluation.score}<span className="text-base text-[#6f9880]">/10</span>
                </p>
              </div>
              <p className="mt-3 text-sm leading-6 text-[#58665d]">{data.evaluation.fitAnalysis}</p>
              <div className="mt-4 grid gap-4 text-xs sm:grid-cols-2">
                <div><p className="font-extrabold uppercase tracking-[0.1em] text-[#39865f]">Strengths</p><ul className="mt-2 list-disc space-y-1 pl-4 text-[#58665d]">{data.evaluation.matchStrengths.map((item) => <li key={item}>{item}</li>)}</ul></div>
                <div><p className="font-extrabold uppercase tracking-[0.1em] text-[#bd6454]">Gaps</p><ul className="mt-2 list-disc space-y-1 pl-4 text-[#58665d]">{data.evaluation.matchGaps.map((item) => <li key={item}>{item}</li>)}</ul></div>
              </div>
            </div>
            <div className="mt-7 grid gap-3 sm:grid-cols-2">
              {data.values.map((item) => (
                <div
                  key={item.label}
                  className="rounded-xl border border-[#e0e7df] bg-white p-4"
                >
                  <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#87938b]">
                    {item.label}
                  </p>
                  <p className="mt-1 truncate text-sm font-semibold">
                    {item.value || "Not found"}
                  </p>
                </div>
              ))}
            </div>
            <div className="mt-6">
              <p className="mb-3 text-xs font-extrabold uppercase tracking-[0.12em] text-[#718078]">
                Drafted screening answers
              </p>
              <div className="space-y-3">
                {data.answers.map((answer) => (
                  <div
                    key={answer.label}
                    className="border-l-2 border-[#9ce3b8] pl-4"
                  >
                    <p className="text-xs font-bold">{answer.label}</p>
                    <p className="mt-1 text-sm leading-6 text-[#58665d]">
                      {answer.answer}
                    </p>
                  </div>
                ))}
              </div>
            </div>
            <div className="mt-7 flex flex-col gap-3 border-t border-[#e2e8e1] pt-5 sm:flex-row sm:items-center sm:justify-between">
              <a
                href={data.jobUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 text-xs font-bold text-[#39865f] hover:underline"
              >
                Open application <ExternalLink size={14} />
              </a>
              <button
                onClick={onContinue}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#17211d] px-5 py-3 text-sm font-extrabold text-white transition hover:-translate-y-0.5 hover:bg-[#2c4035]"
              >
                <Check size={17} /> Continue manual review
              </button>
            </div>
            <p className="mt-3 text-right text-[11px] text-[#8a968e]">
              This never submits the form. Submission remains a manual action in
              the browser after you review every field.
            </p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
