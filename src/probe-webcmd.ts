/**
 * Manual integration probe — exercises the real webcmd programs against a live
 * session using a local data: URL that embeds a small form. Run with tsx:
 *   npx tsx src/probe-webcmd.ts
 * This does NOT exercise the full ApplyFlow pipeline; it validates the program
 * builders (analyze/waitFor/fill/select/radio/upload/scroll) in the sandbox.
 */
import { WebcmdSession } from "./filler/webcmd-session.js";
import {
  gotoProgram,
  waitForFormProgram,
  analyzeFormProgram,
  fillFieldProgram,
  fillSelectProgram,
  fillRadioProgram,
  scrollToSubmitProgram,
} from "./filler/webcmd-programs.js";

const FORM_HTML = encodeURIComponent(`
<!doctype html>
<html><body>
<form class="application-form">
  <label for="fname">First Name *</label>
  <input id="fname" name="first_name" required />
  <label for="email">Email</label>
  <input id="email" type="email" name="email" />
  <label for="city">City</label>
  <select id="city" name="city">
    <option value="">Select…</option>
    <option value="nyc">New York</option>
    <option value="sf">San Francisco</option>
  </select>
  <fieldset>
    <legend>Sponsorship?</legend>
    <label><input type="radio" name="sponsor" value="yes" /> Yes</label>
    <label><input type="radio" name="sponsor" value="no" /> No</label>
  </fieldset>
  <label for="why">Why us?</label>
  <textarea id="why" name="why"></textarea>
  <button type="submit">Submit Application</button>
</form>
</body></html>
`);

async function main(): Promise<void> {
  const session = new WebcmdSession("applyflow", "probe");

  await session.launch();
  console.log("session id:", session.id);

  const url = `data:text/html,${FORM_HTML}`;
  await session.navigate(url);

  // 1. waitForForm
  const waitResult = await session.runProgram(waitForFormProgram(
    [".application-form", "form"],
    10_000
  ));
  console.log("waitForForm ->", JSON.stringify(waitResult.result));

  // 2. analyzeForm
  const analyzeResult = await session.runProgram(analyzeFormProgram());
  console.log("analyze ->", JSON.stringify(analyzeResult.result, null, 2).slice(0, 1800));

  // 3. fillField (by label)
  const fillResult = await session.runProgram(fillFieldProgram("First Name", "Ada", "#fname"));
  console.log("fillField ->", JSON.stringify(fillResult.result));
  const fillResult2 = await session.runProgram(fillFieldProgram("Email", "ada@example.com", "#email"));
  console.log("fillField2 ->", JSON.stringify(fillResult2.result));

  // 4. fillSelect (by label)
  const selectResult = await session.runProgram(fillSelectProgram("City", "San Francisco", "#city"));
  console.log("fillSelect ->", JSON.stringify(selectResult.result));

  // 5. fillRadio (yes/no)
  const radioResult = await session.runProgram(fillRadioProgram("Sponsorship?", "Yes", ""));
  console.log("fillRadio ->", JSON.stringify(radioResult.result));

  // 6. scroll to submit
  const scrollResult = await session.runProgram(scrollToSubmitProgram('button[type="submit"]'));
  console.log("scroll ->", JSON.stringify(scrollResult.result));

  await session.close();
  console.log("DONE");
}

main().catch((err) => {
  console.error("PROBE FAILED:", err);
  process.exit(1);
});