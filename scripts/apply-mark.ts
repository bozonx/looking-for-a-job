/**
 * Фиксация результата отклика (dev_docs/apply-plan.md §6, шаг 6): статус вакансии + application.md + лог прогона.
 * `npm run apply-mark -- <id> <действие> [текст]`
 *
 *   applied                         status: applied, applied_at, apply_log; application.md → submitted
 *   skip      <причина>             статус не меняется; application.md → skipped; причина в лог
 *   not-fit   <причина>             статус не меняется; причина дописывается в notes; application.md → skipped
 *   attention <reason> <описание>   status: needs_attention, attention_reason (unknown_question|special_media|captcha|login|ambiguous|other)
 *   failed    <описание>            status: apply_failed
 *   filled                          только application.md → filled (форма заполнена, ждёт проверки)
 *
 * Лог: data/runs/<дата>-apply.md. После — `npm run validate`.
 */
import { parseVacancy, resolveTargets, writeVacancy } from './lib/vacancy.ts';
import { appendRunLog } from './lib/runlog.ts';
import { applyUrl, setApplicationFields } from './lib/apply.ts';

const REASONS = ['unknown_question', 'special_media', 'captcha', 'login', 'ambiguous', 'other'];
const [id, action, ...restArgs] = process.argv.slice(2);
if (!id || !action) {
  console.error('usage: npm run apply-mark -- <id> applied|skip|not-fit|attention|failed|filled [текст]');
  process.exit(1);
}
const [file] = resolveTargets([id]);
const { data: d, body } = parseVacancy(file!);
const now = new Date().toISOString();
const time = now.slice(11, 16);
let text = restArgs.join(' ').trim();
let line = '';
const logFile = `data/runs/${now.slice(0, 10)}-apply.md`;

switch (action) {
  case 'applied':
    d.status = 'applied';
    d.applied_at = now;
    d.apply_log = logFile;
    d.applied_via = 'agent';
    d.attention_reason = null;
    d.attention_details = null;
    setApplicationFields(d.id, { state: 'submitted', submitted_at: now });
    line = `отправлено`;
    break;
  case 'skip':
    setApplicationFields(d.id, { state: 'skipped' });
    line = `пропущено`;
    break;
  case 'not-fit':
    d.notes = [d.notes, `[агент ${now.slice(0, 10)}] не подходит (отклик): ${text || 'без причины'}`].filter(Boolean).join('\n');
    setApplicationFields(d.id, { state: 'skipped' });
    line = `не подходит`;
    break;
  case 'attention': {
    const reason = restArgs[0] ?? '';
    if (!REASONS.includes(reason)) {
      console.error(`reason: ${REASONS.join('|')}`);
      process.exit(1);
    }
    text = restArgs.slice(1).join(' ').trim();
    d.status = 'needs_attention';
    d.attention_reason = reason;
    d.attention_details = text || null;
    line = `needs_attention: ${reason}`;
    break;
  }
  case 'failed':
    d.status = 'apply_failed';
    d.attention_details = text || null;
    line = `apply_failed`;
    break;
  case 'filled':
    setApplicationFields(d.id, { state: 'filled' });
    line = `форма заполнена, ждёт проверки`;
    break;
  default:
    console.error(`неизвестное действие ${action}`);
    process.exit(1);
}

if (action !== 'filled') writeVacancy(file!, d, body);
const log = appendRunLog('apply', `- ${time} UTC · **${d.company} — ${d.title}** (\`${d.id}\`) · ${line}${text ? ` — ${text}` : ''} · ${applyUrl(d)}`);
console.log(`✓ ${d.id}: ${line}\n  лог: ${log}`);

