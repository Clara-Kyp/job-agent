import type { WebcmdSession } from "../filler/webcmd-session.js";

export interface BeisenField {
  section: string;
  sectionIndex: number;
  fieldIndex: number;
  label: string;
  required: boolean;
  control: "text" | "textarea" | "file" | "select" | "date" | "choice" | "unknown";
  placeholder: string;
  locator: string;
}

export interface BeisenFormMap {
  fields: BeisenField[];
  sectionCount: number;
  uploads: Array<{ kind: "resume" | "photo" | "attachment" | "unknown"; accept: string; multiple: boolean; locator: string }>;
}

/** Read only. Never extracts input values or selected choices. */
export async function parseBeisenForm(session: WebcmdSession): Promise<BeisenFormMap> {
  const result = await session.runProgram(`return await page.evaluate(() => {
    const sections = Array.from(document.querySelectorAll('.form-part'));
    const sectionNames = ['推荐码', '基本信息', '求职意向', '教育经历', '工作经历', '项目经历', '语言能力', '附件'];
    const fields = Array.from(document.querySelectorAll('.form-item')).map((item, fieldIndex) => {
      const label = (item.querySelector('label.form-item__text, label')?.textContent || '').trim().replace(/\\s+/g, ' ');
      const parentSection = item.closest('.form-part');
      const sectionIndex = sections.indexOf(parentSection);
      const section = sectionNames[sectionIndex] || '其他';
      const input = item.querySelector('input:not([type="hidden"]), textarea, select');
      let control = 'unknown';
      if (item.querySelector('input[type="file"]')) control = 'file';
      else if (item.querySelector('textarea')) control = 'textarea';
      else if (item.querySelector('.phoenix-radio, input[type="radio"], .phoenix-checkbox, input[type="checkbox"]')) control = 'choice';
      else if (item.querySelector('[class*="date"], [class*="Date"], [class*="calendar"], [class*="Calendar"]') || /日期|开始时间|结束时间/.test(label)) control = 'date';
      else if (item.querySelector('.phoenix-select, select')) control = 'select';
      else if (input) control = 'text';
      return {
        section, sectionIndex, fieldIndex, label,
        required: !!item.querySelector('.form-item__required, [aria-required="true"]'),
        control,
        placeholder: input?.getAttribute('placeholder') || '',
        locator: '.form-item >> nth=' + fieldIndex,
      };
    }).filter(field => field.label);
    const uploads = Array.from(document.querySelectorAll('input[type="file"]')).map((input, index) => {
      const label = (input.closest('.form-item')?.querySelector('label')?.textContent || '').trim();
      const kind = label === '证件照' ? 'photo' : label === '附件' ? 'attachment' :
        !input.closest('.form-item') && document.body.innerText.includes('上传简历') ? 'resume' : 'unknown';
      return { kind, accept: input.getAttribute('accept') || '', multiple: input.multiple,
        locator: 'input[type="file"] >> nth=' + index };
    });
    return { fields, sectionCount: sections.length, uploads };
  });`);
  return result.result as BeisenFormMap;
}
