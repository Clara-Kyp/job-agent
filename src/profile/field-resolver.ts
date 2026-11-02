import type { CandidateProfile, FormField, UnresolvedField } from "../types/index.js";

export interface ResolvedField {
  value: string;
  confidence: number;
  sensitive: boolean;
}

function yesNo(value: boolean | null): string {
  return value === null ? "" : value ? "Yes" : "No";
}

export function resolveProfileField(label: string, profile: CandidateProfile): ResolvedField {
  const lower = label.toLowerCase();
  if (/gender|race|ethnicity|veteran|disability|demographic|pronoun/.test(lower)) {
    return { value: "", confidence: 0, sensitive: true };
  }
  const nameParts = profile.candidate.fullName.trim().split(/\s+/).filter(Boolean);
  const candidates: Array<[RegExp, string, boolean?]> = [
    [/first name|given name/, nameParts[0] || ""],
    [/last name|family name|surname/, nameParts.slice(1).join(" ")],
    [/full name|^name$/, profile.candidate.fullName],
    [/e-?mail/, profile.candidate.email],
    [/phone|telephone|mobile/, profile.candidate.phone],
    [/linkedin/, profile.candidate.linkedin],
    [/github/, profile.candidate.github],
    [/portfolio|personal website|website/, profile.candidate.portfolio || profile.candidate.github],
    [/\bcity\b/, profile.candidate.city],
    [/\bcountry\b/, profile.candidate.country],
    [/salary|compensation|pay expectation/, profile.preferences.desiredSalary, true],
    [/start date|available to start|earliest start/, profile.preferences.earliestStartDate],
    [/notice period/, profile.preferences.noticePeriod],
    [/location preference|preferred location/, profile.preferences.locationPreference],
    [/relocat/, yesNo(profile.preferences.willingToRelocate)],
    [/sponsor/, yesNo(profile.workAuthorization.requiresSponsorship), true],
    [/visa|immigration status/, profile.workAuthorization.visaStatus, true],
    [/authori[sz]ed to work|work permit/, profile.workAuthorization.authorizedCountries.length ? "Yes" : "", true],
  ];

  for (const [pattern, value, sensitive = false] of candidates) {
    if (pattern.test(lower)) return { value, confidence: value ? 1 : 0, sensitive };
  }
  const remembered = Object.entries(profile.commonAnswers).find(([question]) =>
    lower.includes(question.toLowerCase()) || question.toLowerCase().includes(lower),
  );
  return remembered
    ? { value: remembered[1], confidence: 0.95, sensitive: false }
    : { value: "", confidence: 0, sensitive: false };
}

export function unresolvedStandardFields(fields: FormField[], profile: CandidateProfile): UnresolvedField[] {
  return fields.flatMap((field) => {
    if (field.type === "file" || field.type === "checkbox") return [];
    const resolved = resolveProfileField(field.label, profile);
    if (resolved.value) return [];
    return [{
      label: field.label,
      required: field.required,
      reason: resolved.sensitive ? "sensitive_field" as const : "missing_profile_data" as const,
    }];
  });
}
