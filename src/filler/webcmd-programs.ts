/**
 * Builders for webcmd browser-run programs.
 *
 * Every function returns a JavaScript source string executed inside webcmd's
 * QuickJS sandbox. Inside the sandbox only these globals exist:
 *   page, context, browser, console, TextEncoder, Uint8Array, setTimeout
 *
 * There is NO `require`, `fs`, `Buffer`, `document`, or `window` at top level —
 * DOM access happens only via `page.evaluate`, and file I/O only via
 * Playwright's own methods (e.g. `setInputFiles`), which webcmd resolves on the
 * host side.
 *
 * All interpolated values are JSON-escaped so labels/URLs/values containing
 * quotes or newlines never break the program source.
 */

/** JSON-encode a value for safe interpolation into a program string. */
function js(value: unknown): string {
  return JSON.stringify(value);
}

/**
 * Navigate to a URL and wait for dynamic content to settle.
 * Returns `{ url, title }`.
 */
export function gotoProgram(url: string): string {
  return [
    `await page.goto(${js(url)}, { waitUntil: 'domcontentloaded', timeout: 30000 });`,
    `await page.waitForTimeout(2000);`,
    `return { url: page.url(), title: await page.title() };`,
  ].join("\n");
}

/**
 * Wait for any form-like element to appear.
 *
 * `formSelectors` is an ordered candidate list (already ATS-tuned by the caller).
 * Each selector gets only a short slice of the budget so a specific-but-absent
 * class never starves the generic `form` fallback. The overall `timeoutMs` is
 * still enforced by webcmd's run timeout, which kills the program if nothing
 * ever matches.
 */
export function waitForFormProgram(formSelectors: string[], timeoutMs: number): string {
  const selList = formSelectors
    .map((sel) => js(sel))
    .join(", ");
  // Give every candidate an equal share of the budget, min 1.5s, max 5s each.
  const perSelector = Math.min(5000, Math.max(1500, Math.floor(timeoutMs / formSelectors.length)));
  return [
    `const candidates = [${selList}];`,
    `let found = false;`,
    `for (const sel of candidates) {`,
    `  try {`,
    `    await page.waitForSelector(sel, { state: 'attached', timeout: ${perSelector} });`,
    `    found = true;`,
    `    break;`,
    `  } catch (e) {}`,
    `}`,
    `return { found };`,
  ].join("\n");
}

/**
 * Crawl the current page's form fields and return structured metadata.
 * Returns `{ url, ats, fields, submitSelector, resumeSelector }` where each
 * field carries { tagName, type, name, id, label, placeholder, required,
 * options, selector, ariaLabel }.
 */
export function analyzeFormProgram(): string {
  return [
    `const url = page.url();`,
    `const lowerUrl = url.toLowerCase();`,
    `let ats = 'unknown';`,
    `if (lowerUrl.includes('greenhouse')) ats = 'greenhouse';`,
    `else if (lowerUrl.includes('lever')) ats = 'lever';`,
    `else if (lowerUrl.includes('workday')) ats = 'workday';`,
    `else if (lowerUrl.includes('icims')) ats = 'icims';`,
    `else if (lowerUrl.includes('taleo')) ats = 'taleo';`,
    ``,
    `const crawl = await page.evaluate(() => {`,
    `  const domAts = (function () {`,
    `    if (document.querySelector('.application-form, #application_form, .job-application-form')) return 'greenhouse';`,
    `    if (document.querySelector('.postings-form')) return 'lever';`,
    `    return null;`,
    `  })();`,
    ``,
    `  const fields = [];`,
    `  const elements = document.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"]), textarea, select');`,
    ``,
    `  elements.forEach((el) => {`,
    `    const tagName = el.tagName;`,
    `    if (el.offsetParent === null && !el.closest('[data-qa]')) return;`,
    ``,
    `    let label = '';`,
    `    if (el.id) {`,
    `      const labelEl = document.querySelector('label[for="' + cssEscape(el.id) + '"]');`,
    `      if (labelEl) label = labelEl.textContent ? labelEl.textContent.trim() : '';`,
    `    }`,
    `    if (!label) {`,
    `      const parentLabel = el.closest('label');`,
    `      if (parentLabel) {`,
    `        const clone = parentLabel.cloneNode(true);`,
    `        clone.querySelectorAll('input, textarea, select').forEach((child) => child.remove());`,
    `        label = clone.textContent ? clone.textContent.trim() : '';`,
    `      }`,
    `    }`,
    `    if (!label) label = el.getAttribute('aria-label') || '';`,
    `    if (!label) label = el.getAttribute('placeholder') || '';`,
    `    if (!label) {`,
    `      label = (el.getAttribute('name') || '').replace(/[-_]/g, ' ').replace(/\\b\\w/g, (c) => c.toUpperCase());`,
    `    }`,
    ``,
    `    const options = [];`,
    `    if (tagName === 'SELECT') {`,
    `      for (let i = 0; i < el.options.length; i++) {`,
    `        const opt = el.options[i];`,
    `        if (opt.value && opt.value !== '') options.push(opt.textContent ? opt.textContent.trim() : opt.value);`,
    `      }`,
    `    }`,
    ``,
    `    let selector = '';`,
    `    const id = el.id || '';`,
    `    const nameAttr = el.getAttribute('name') || '';`,
    `    const dataQa = el.getAttribute('data-qa') || '';`,
    `    if (id) selector = '#' + cssEscape(id);`,
    `    else if (nameAttr) selector = '[name="' + nameAttr + '"]';`,
    `    else if (label) selector = 'label:has-text("' + label + '") + input, label:has-text("' + label + '") input';`,
    `    else if (dataQa) selector = '[data-qa="' + dataQa + '"]';`,
    ``,
    `    fields.push({`,
    `      tagName,`,
    `      type: el.getAttribute('type') || 'text',`,
    `      name: nameAttr,`,
    `      id: id,`,
    `      label: label.slice(0, 100),`,
    `      placeholder: el.getAttribute('placeholder') || '',`,
    `      required: el.required || el.getAttribute('aria-required') === 'true',`,
    `      options: options,`,
    `      selector: selector,`,
    `      ariaLabel: el.getAttribute('aria-label') || '',`,
    `    });`,
    `  });`,
    ``,
    `  const submitButtons = document.querySelectorAll('button[type="submit"], input[type="submit"], button[data-qa], button[class*="submit"], button[class*="apply"], button[class*="btn-primary"]');`,
    `  let submitSelector = 'button[type="submit"]';`,
    `  if (submitButtons.length > 0) {`,
    `    const btn = submitButtons[0];`,
    `    if (btn.id) submitSelector = '#' + cssEscape(btn.id);`,
    `    else if (btn.getAttribute('data-qa')) submitSelector = '[data-qa="' + btn.getAttribute('data-qa') + '"]';`,
    `    else if (btn.textContent && btn.textContent.trim()) submitSelector = 'button:has-text("' + btn.textContent.trim().slice(0, 30) + '")';`,
    `  }`,
    ``,
    `  const fileInputs = document.querySelectorAll('input[type="file"]');`,
    `  let resumeSelector = undefined;`,
    `  if (fileInputs.length > 0) {`,
    `    let chosen = null;`,
    `    for (const fi of fileInputs) {`,
    `      const name = fi.getAttribute('name') || '';`,
    `      const accept = fi.getAttribute('accept') || '';`,
    `      if (name.toLowerCase().includes('resume') || name.toLowerCase().includes('cv') || accept.includes('pdf') || accept.includes('doc')) {`,
    `        chosen = fi;`,
    `        break;`,
    `      }`,
    `    }`,
    `    if (!chosen) chosen = fileInputs[0];`,
    `    if (chosen) {`,
    `      if (chosen.id) resumeSelector = '#' + cssEscape(chosen.id);`,
    `      else if (chosen.getAttribute('name')) resumeSelector = '[name="' + chosen.getAttribute('name') + '"]';`,
    `      else resumeSelector = 'input[type="file"]';`,
    `    }`,
    `  }`,
    ``,
    `  function cssEscape(value) {`,
    `    return String(value).replace(/["\\\\\\n\\r]/g, (m) => {`,
    `      if (m === '"') return '\\\\"';`,
    `      if (m === '\\\\') return '\\\\\\\\';`,
    `      return '';`,
    `    });`,
    `  }`,
    ``,
    `  return { domAts: domAts, fields: fields, submitSelector: submitSelector, resumeSelector: resumeSelector };`,
    `});`,
    ``,
    `const finalAts = ats === 'unknown' ? (crawl.domAts || 'unknown') : ats;`,
    `return {`,
    `  url: url,`,
    `  ats: finalAts,`,
    `  fields: crawl.fields,`,
    `  submitSelector: crawl.submitSelector,`,
    `  resumeSelector: crawl.resumeSelector === undefined ? null : crawl.resumeSelector,`,
    `};`,
  ].join("\n");
}

/**
 * Fill a text-like field using progressively less semantic strategies:
 * getByLabel → getByPlaceholder → getByRole(textbox) → CSS selector → label wrapper.
 * Returns `{ ok, method }`.
 */
export function fillFieldProgram(
  label: string,
  value: string,
  selector?: string
): string {
  return [
    `const strategies = [`,
    `  () => page.getByLabel(${js(label)}, { exact: false }),`,
    `  () => page.getByPlaceholder(${js(label)}, { exact: false }),`,
    `  () => page.getByRole('textbox', { name: ${js(label)}, exact: false }),`,
    `  ${selector ? `() => page.locator(${js(selector)})` : `() => null`},`,
    `];`,
    `const methodNames = ['label', 'placeholder', 'role', 'selector'];`,
    `for (let i = 0; i < strategies.length; i++) {`,
    `  let loc;`,
    `  try { loc = strategies[i](); } catch (e) { continue; }`,
    `  if (!loc) continue;`,
    `  try {`,
    `    if (await loc.count() > 0) {`,
    `      await loc.first().fill(${js(value)});`,
    `      return { ok: true, method: methodNames[i] };`,
    `    }`,
    `  } catch (e) {}`,
    `}`,
    `// Label wrapper fallback (wrapping label → sibling → ancestor container)`,
    `try {`,
    `  const labelLoc = page.locator('label').filter({ hasText: ${js(label)} }).first();`,
    `  if (await labelLoc.count() > 0) {`,
    `    const wrapped = labelLoc.locator('input, textarea, select').first();`,
    `    if (await wrapped.count() > 0) { await wrapped.fill(${js(value)}); return { ok: true, method: 'wrapped' }; }`,
    `    const sibling = labelLoc.locator('xpath=following-sibling::*[self::input or self::textarea or self::select][1]');`,
    `    if (await sibling.count() > 0) { await sibling.fill(${js(value)}); return { ok: true, method: 'sibling' }; }`,
    `    const inContainer = labelLoc.locator('xpath=..//input | ..//textarea | ..//select').first();`,
    `    if (await inContainer.count() > 0) { await inContainer.fill(${js(value)}); return { ok: true, method: 'container' }; }`,
    `  }`,
    `} catch (e) {}`,
    `return { ok: false };`,
  ].join("\n");
}

/**
 * Fill a single- or multi-select: match option by label text, then by value,
 * then by a DOM fuzzy text match.
 * Returns `{ ok, method }`.
 */
export function fillSelectProgram(
  label: string,
  value: string,
  selector?: string
): string {
  return [
    `let ok = false;`,
    `let method = '';`,
    `try {`,
    `  const loc = page.getByLabel(${js(label)}, { exact: false });`,
    `  if (await loc.count() > 0) {`,
    `    await loc.first().selectOption({ label: ${js(value)} });`,
    `    ok = true; method = 'label';`,
    `  }`,
    `} catch (e) {}`,
    `${selector ? [
      `if (!ok) {`,
      `  try {`,
      `    const loc = page.locator(${js(selector)}).first();`,
      `    if (await loc.count() > 0) {`,
      `      await loc.selectOption({ label: ${js(value)} }); ok = true; method = 'selector-label';`,
      `    }`,
      `  } catch (e) {}`,
      `}`,
      `if (!ok) {`,
      `  try {`,
      `    const loc = page.locator(${js(selector)}).first();`,
      `    if (await loc.count() > 0) {`,
      `      await loc.selectOption(${js(value)}); ok = true; method = 'selector-value';`,
      `    }`,
      `  } catch (e) {}`,
      `}`,
      `if (!ok) {`,
      `  try {`,
      `    const idx = await page.evaluate(({ sel, want }) => {`,
      `      const el = document.querySelector(sel);`,
      `      if (!el || !el.options) return -1;`,
      `      const wantLower = String(want).toLowerCase();`,
      `      for (let i = 0; i < el.options.length; i++) {`,
      `        const text = (el.options[i].text || '').trim().toLowerCase();`,
      `        if (text === wantLower || text.startsWith(wantLower) || wantLower.includes(text)) return i;`,
      `      }`,
      `      return -1;`,
      `    }, { sel: ${js(selector)}, want: ${js(value)} });`,
      `    if (idx >= 0) {`,
      `      await page.locator(${js(selector)}).first().selectOption({ index: idx });`,
      `      ok = true; method = 'fuzzy';`,
      `    }`,
      `  } catch (e) {}`,
      `}`,
    ].join("\n") : ""}`,
    `return { ok: ok, method: method };`,
  ].join("\n");
}

/**
 * Check the correct radio option for a yes/no (or labelled-option) question.
 * Uses a DOM scan to pick the radio whose value/text matches the desired answer.
 * Returns `{ ok }`.
 */
export function fillRadioProgram(
  label: string,
  value: string,
  selector?: string
): string {
  return [
    `const value = ${js(value)};`,
    `const lowerVal = String(value).toLowerCase();`,
    `const isYes = lowerVal === 'yes' || lowerVal === 'true' || lowerVal === '1';`,
    `const desired = isYes ? ['yes', 'true', '1'] : ['no', 'false', '0'];`,
    ``,
    `let ok = false;`,
    ``,
    `// Fast path: a selector that already names a specific radio input`,
    `${selector ? [
      `if (!ok && ${js(selector)}) {`,
      `  try {`,
      `    const loc = page.locator(${js(selector)});`,
      `    if (await loc.count() > 0) {`,
      `      await loc.first().check({ force: true });`,
      `      ok = true;`,
      `    }`,
      `  } catch (e) {}`,
      `}`,
      `// Group selector: pick the option whose value matches`,
      `if (!ok && ${js(selector)}) {`,
      `  try {`,
      `    const group = page.locator(${js(selector)});`,
      `    const radios = group.locator('input[type="radio"], input[type=radio]');`,
      `    const count = await radios.count();`,
      `    for (let i = 0; i < count; i++) {`,
      `      const r = radios.nth(i);`,
      `      const rv = await r.inputValue().catch(() => '');`,
      `      if (desired.includes(String(rv).toLowerCase())) {`,
      `        await r.check({ force: true });`,
      `        ok = true;`,
      `        break;`,
      `      }`,
      `    }`,
      `  } catch (e) {}`,
      `}`,
    ].join("\n") : ""}`,
    ``,
    `// DOM-scan path: locate the radio whose group heading matches the field`,
    `// label and whose value (or option text) matches the desired answer.`,
    `if (!ok) {`,
    `  try {`,
    `    const chosen = await page.evaluate(({ label, want }) => {`,
    `      const wantLower = String(want).toLowerCase();`,
    `      const radios = Array.from(document.querySelectorAll('input[type="radio"]'));`,
    `      if (radios.length === 0) return null;`,
    `      function selectorFor(r) {`,
    `        if (r.id) return '#' + r.id;`,
    `        if (r.name && r.value !== undefined) return 'input[name=' + JSON.stringify(r.name) + '][value=' + JSON.stringify(String(r.value || '')) + ']';`,
    `        return null;`,
    `      }`,
    `      // Group containers whose heading (label/legend/[role=group]/fieldset)`,
    `      // mentions the field label text.`,
    `      const headingEls = Array.from(document.querySelectorAll('label, legend, [role="group"], fieldset')).filter(`,
    `        (el) => el.textContent && el.textContent.toLowerCase().includes(String(label).toLowerCase())`,
    `      );`,
    `      const containers = headingEls.filter((el) => el.querySelector('input[type="radio"]') !== null);`,
    `      let pool = radios;`,
    `      if (containers.length > 0) {`,
    `        const inGroup = radios.filter((r) => containers.some((c) => c.contains(r)));`,
    `        if (inGroup.length > 0) pool = inGroup;`,
    `      }`,
    `      // 1) Exact value match`,
    `      for (const r of pool) {`,
    `        if (String(r.value || '').toLowerCase() === wantLower) return selectorFor(r);`,
    `      }`,
    `      // 2) Option text match (the radio's wrapping label text)`,
    `      for (const r of pool) {`,
    `        const lbl = r.closest('label');`,
    `        const text = (lbl ? lbl.textContent : '').trim().toLowerCase();`,
    `        if (text === wantLower || text.indexOf(wantLower) === 0) return selectorFor(r);`,
    `      }`,
    `      return null;`,
    `    }, { label: ${js(label)}, want: value });`,
    `    if (chosen) {`,
    `      await page.locator(chosen).first().check({ force: true });`,
    `      ok = true;`,
    `    }`,
    `  } catch (e) {}`,
    `}`,
    `return { ok: ok };`,
  ].join("\n");
}

/**
 * Upload a resume file to the file input matching `selector`.
 * `resumePath` must be an absolute path on the host — webcmd resolves it
 * daemon-side. Returns `{ ok }`.
 */
export function uploadResumeProgram(
  selector: string,
  resumePath: string
): string {
  return [
    `let ok = false;`,
    `try {`,
    `  const fileInput = page.locator(${js(selector)}).first();`,
    `  if (await fileInput.count() > 0) {`,
    `    await fileInput.setInputFiles(${js(resumePath)});`,
    `    ok = true;`,
    `  }`,
    `} catch (e) {`,
    `  console.log('upload error: ' + (e && e.message ? e.message : String(e)));`,
    `}`,
    `return { ok: ok };`,
  ].join("\n");
}

/**
 * Scroll the submit button into view, then nudge up so it sits at the bottom
 * of the viewport for human review. Falls back to page-bottom scroll.
 * Returns `{ ok }`.
 */
export function scrollToSubmitProgram(submitSelector: string): string {
  return [
    `let done = false;`,
    `if (${js(submitSelector)}) {`,
    `  try {`,
    `    const btn = page.locator(${js(submitSelector)}).first();`,
    `    if (await btn.count() > 0) {`,
    `      await btn.scrollIntoViewIfNeeded();`,
    `      await page.waitForTimeout(500);`,
    `      await page.evaluate(() => { window.scrollBy(0, 200); });`,
    `      done = true;`,
    `    }`,
    `  } catch (e) {}`,
    `}`,
    `if (!done) {`,
    `  try {`,
    `    await page.evaluate(() => { window.scrollTo(0, document.body.scrollHeight - 200); });`,
    `    done = true;`,
    `  } catch (e) {}`,
    `}`,
    `return { ok: done };`,
  ].join("\n");
}

/**
 * Render a URL in a real browser and return its serialized HTML plus the final
 * URL — used by the job scraper as a fallback when static parsing fails on a
 * JS-rendered board page. Follows the first specific `/jobs/<id>` link if the
 * page turns out to be a board list.
 * Returns `{ html, url }`.
 */
export function renderRenderedHtmlProgram(url: string): string {
  return [
    `await page.goto(${js(url)}, { waitUntil: 'domcontentloaded', timeout: 30000 });`,
    `await page.waitForTimeout(3000);`,
    ``,
    `const firstJobLink = await page.evaluate(() => {`,
    `  const anchors = Array.from(document.querySelectorAll('a[href*="/jobs/"]'));`,
    `  const jobLink = anchors.find((a) => /\\/jobs\\/\\d+/.test(a.getAttribute('href') || ''));`,
    `  return jobLink ? (jobLink.getAttribute('href') || null) : null;`,
    `});`,
    `let finalUrl = page.url();`,
    `if (firstJobLink) {`,
    `  const nextUrl = new URL(firstJobLink, ${js(url)}).href;`,
    `  await page.goto(nextUrl, { waitUntil: 'domcontentloaded' });`,
    `  await page.waitForTimeout(2000);`,
    `  finalUrl = page.url();`,
    `}`,
    `const html = await page.content();`,
    `return { html: html, url: finalUrl };`,
  ].join("\n");
}

/**
 * List open pages/tabs in the session. Used for diagnostics.
 * Returns `{ tabs: [{ url, title }] }`.
 */
export function getTabsProgram(): string {
  return [
    `const tabs = [];`,
    `try {`,
    `  const pages = await context.pages();`,
    `  for (const p of pages) {`,
    `    let url = '';`,
    `    let title = '';`,
    `    try { url = p.url(); } catch (e) {}`,
    `    try { title = await p.title(); } catch (e) {}`,
    `    tabs.push({ url: url, title: title });`,
    `  }`,
    `} catch (e) {}`,
    `return { tabs: tabs };`,
  ].join("\n");
}

/**
 * Close the current page.
 * Returns `{ ok }`.
 */
export function closeWindowProgram(): string {
  return [
    `try {`,
    `  await page.close();`,
    `} catch (e) {}`,
    `return { ok: true };`,
  ].join("\n");
}