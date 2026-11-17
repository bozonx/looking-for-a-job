/**
 * Проверка журнала data/insights.md (формат — playbooks/collect.md, шаг 6).
 * Журнал — только то, что требует действия: каждая строка `- [тег] <где>: <наблюдение> → <действие>`.
 * Похвала («высокий балл», «успешно разрешена»), повторы и теги вне списка — шум: их отсеивает validate.
 */

/** Допустимые теги. `[resume]` больше не пишется при сборе: рынок для резюме — resume_match + npm run insights. */
export const JOURNAL_TAGS = ['filter', 'source', 'scoring', 'bug', 'analysis', 'resume-update'] as const;

/** Формулировки «всё хорошо» — не требуют действия. */
const PRAISE = /(высок\S* балл|отличн\S* матч|успешно|подтверждают релевантность|ожидаемо|справедливо|обоснованн\S* стоп)/i;

export interface JournalIssue {
  line: number;
  text: string;
  problem: string;
}

const norm = (s: string) => s.toLowerCase().replace(/\d+/g, '#').replace(/[^\p{L}#]+/gu, ' ').trim();

export function checkJournal(text: string): JournalIssue[] {
  const issues: JournalIssue[] = [];
  const seen = new Map<string, number>();
  text.split('\n').forEach((raw, i) => {
    const line = i + 1;
    const m = /^- \[([a-z-]+)\]\s*(.*)$/.exec(raw.trim());
    if (!m) return;
    const [, tag, body] = m as unknown as [string, string, string];
    const add = (problem: string) => issues.push({ line, text: raw.trim().slice(0, 100), problem });
    if (!(JOURNAL_TAGS as readonly string[]).includes(tag)) add(`тег [${tag}] не из списка: ${JOURNAL_TAGS.join(', ')}`);
    if (tag === 'analysis' || tag === 'resume-update') return;
    if (!body.includes('→')) add('нет «→ действие»: запись без предлагаемого действия — шум');
    if (PRAISE.test(body)) add('похоже на констатацию «всё хорошо» — в журнал не пишется');
    const k = norm(body.split('→')[0]!);
    const prev = seen.get(k);
    if (prev) add(`повтор строки ${prev}`);
    else seen.set(k, line);
  });
  return issues;
}
