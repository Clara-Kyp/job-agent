/**
 * Shared LLM output helpers used by every generator (scorer, drafter, etc.).
 */

/**
 * Parse a JSON string from an LLM response, tolerating markdown code fences
 * that models sometimes wrap structured output in.
 */
export function parseJsonFromText(text: string): unknown {
  return JSON.parse(text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim());
}