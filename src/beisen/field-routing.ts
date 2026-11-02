/** Conservative routing from verified profile values to a site's actual choices. */
export type ChoiceResolution =
  | { status: "matched"; option: string; reason: "exact" | "alias" | "location" }
  | { status: "unresolved"; reason: "missing" | "ambiguous"; candidates: string[] };

const compact = (value: string) => value.trim().replace(/[\s\u00a0]+/g, "").replace(/[（）]/g, (char) => char === "（" ? "(" : ")");

const aliases: Record<string, string[][]> = {
  工作年限: [
    ["应届生", "应届毕业生"],
    ["在校生", "在读学生", "在校学生", "学生"],
    ["无工作经验", "暂无工作经验", "0年"],
  ],
  语言类型: [["英语", "English"]],
  到岗时间: [["随时", "立即到岗", "可立即到岗", "一周内"]],
};

function fieldKind(label: string): string {
  if (/工作年限/.test(label)) return "工作年限";
  if (/语言类型/.test(label)) return "语言类型";
  if (/到岗时间/.test(label)) return "到岗时间";
  return label;
}

function locationVariants(value: string): string[] {
  const normalized = compact(value);
  const variants = [normalized];
  if (/省$/.test(normalized)) variants.push(normalized.replace(/省$/, ""));
  if (/^(?:[^省]+省)?[^市]+市$/.test(normalized)) variants.push(normalized.replace(/^.*?省/, "").replace(/市$/, ""));
  if (/^[^市]+市$/.test(normalized)) variants.push(normalized.replace(/市$/, ""));
  if (/[区县]$/.test(normalized)) variants.push(normalized.replace(/[区县]$/, ""));
  return [...new Set(variants)];
}

export function resolveSiteChoice(label: string, value: string, options: string[]): ChoiceResolution {
  const source = compact(value);
  if (!source) return { status: "unresolved", reason: "missing", candidates: [] };
  const choices = options.map((option) => ({ original: option.trim(), normalized: compact(option) })).filter((choice) => choice.normalized);
  const exact = choices.filter((choice) => choice.normalized === source);
  if (exact.length === 1) return { status: "matched", option: exact[0].original, reason: "exact" };
  if (exact.length > 1) return { status: "unresolved", reason: "ambiguous", candidates: exact.map((choice) => choice.original) };

  const cluster = (aliases[fieldKind(label)] || []).find((group) => group.map(compact).includes(source));
  if (cluster) {
    const matches = choices.filter((choice) => cluster.map(compact).includes(choice.normalized));
    if (matches.length === 1) return { status: "matched", option: matches[0].original, reason: "alias" };
    if (matches.length > 1) return { status: "unresolved", reason: "ambiguous", candidates: matches.map((choice) => choice.original) };
  }

  if (/月薪/.test(label)) {
    const sourceRange = /^(\d+)[-～~](\d+)(?:元\/月)?$/.exec(source);
    if (sourceRange) {
      const matches = choices.filter((choice) => {
        const range = /^(\d+)[-～~](\d+)$/.exec(choice.normalized);
        return range && Number(range[2]) === Number(sourceRange[2]) && Math.abs(Number(range[1]) - Number(sourceRange[1])) <= 1;
      });
      if (matches.length === 1) return { status: "matched", option: matches[0].original, reason: "alias" };
    }
  }

  if (/城市|籍贯/.test(label)) {
    const variants = locationVariants(value);
    const matches = choices.filter((choice) => variants.includes(choice.normalized) || variants.includes(choice.normalized.replace(/[省市区县]$/, "")));
    if (matches.length === 1) return { status: "matched", option: matches[0].original, reason: "location" };
    if (matches.length > 1) return { status: "unresolved", reason: "ambiguous", candidates: matches.map((choice) => choice.original) };
  }
  return { status: "unresolved", reason: "missing", candidates: choices.map((choice) => choice.original) };
}
