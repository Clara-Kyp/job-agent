import assert from "node:assert/strict";
import { resolveSiteChoice } from "./field-routing.js";

assert.deepEqual(resolveSiteChoice("工作年限", "应届生", ["在读学生", "应届毕业生", "1年"]),
  { status: "matched", option: "应届毕业生", reason: "alias" });
assert.deepEqual(resolveSiteChoice("工作年限", "在校生", ["在读学生", "应届毕业生"]),
  { status: "matched", option: "在读学生", reason: "alias" });
assert.equal(resolveSiteChoice("工作年限", "应届生", ["在读学生", "无工作经验"]).status, "unresolved");
assert.equal(resolveSiteChoice("工作年限", "应届生", ["应届生", "应届毕业生"]).status, "matched");
assert.equal(resolveSiteChoice("工作年限", "0 年", ["无工作经验"]).status, "matched");
assert.equal(resolveSiteChoice("工作年限", "1 年", ["1年以下", "1–3年"]).status, "unresolved");
assert.equal(resolveSiteChoice("语言类型", "English", ["英语"]).status, "matched");
assert.equal(resolveSiteChoice("掌握程度", "雅思 6.5", ["熟练", "精通"]).status, "unresolved");
assert.equal(resolveSiteChoice("期望工作城市", "广东省广州市", ["广州", "深圳"]).status, "matched");
assert.equal(resolveSiteChoice("现工作城市", "广东省广州市", ["广州", "深圳"]).status, "matched");
assert.equal(resolveSiteChoice("籍贯", "广东省广州市", ["广州", "深圳"]).status, "matched");
assert.equal(resolveSiteChoice("期望月薪(税前)", "15-30万/年", ["1-2万/月", "2-3万/月"]).status, "unresolved");
assert.equal(resolveSiteChoice("到岗时间", "随时", ["立即到岗", "1个月内"]).status, "matched");
assert.equal(resolveSiteChoice("到岗时间", "2027-06", ["1个月内"]).status, "unresolved");
console.log("Field routing checks passed.");
