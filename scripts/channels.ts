/**
 * Каналы отклика (apply_channels) без сети и без агента: real_url, строка «Apply:» из сбора, площадка с откликом на месте,
 * дубли, email/Telegram/WhatsApp/Facebook/DM из текста. Затем пересчёт apply_target / apply_method.
 * `npm run channels -- [--force] [--dry-run] [id|путь …]`
 * - без --force обрабатываются только вакансии без apply_channels (миграция, ручные правки);
 * - --force — переизвлечь из текста и для остальных (каналы by: agent и уже записанные не удаляются).
 */
import { loadAll, parseVacancy, resolveTargets, writeVacancy } from './lib/vacancy.ts';
import { baseChannels } from './lib/channels.ts';
import { deriveApply } from './lib/target.ts';

const args = process.argv.slice(2);
const force = args.includes('--force');
const dryRun = args.includes('--dry-run');
const ids = args.filter((a) => !a.startsWith('--'));

const files = ids.length ? resolveTargets(ids).map(parseVacancy) : loadAll();
let changed = 0;
const byMethod = new Map<string, number>();
const fromText: string[] = [];
for (const v of files) {
  const d = v.data;
  const before = JSON.stringify([d.apply_channels, d.apply_method, d.apply_target]);
  if (force || ids.length || d.apply_channels === undefined) {
    const old = new Set(((d.apply_channels ?? []) as { value: string }[]).map((c) => c.value));
    d.apply_channels = baseChannels(d, v.body);
    for (const c of d.apply_channels) if (c.by === 'text' && !old.has(c.value)) fromText.push(`${d.id}: ${c.type} ${c.value}`);
  }
  deriveApply(d);
  byMethod.set(d.apply_method, (byMethod.get(d.apply_method) ?? 0) + 1);
  if (before === JSON.stringify([d.apply_channels, d.apply_method, d.apply_target])) continue;
  changed++;
  if (!dryRun) writeVacancy(v.file, d, v.body);
}

console.log(`Обработано: ${files.length}; изменено: ${changed}${dryRun ? ' (dry-run, не записано)' : ''}`);
console.log(`apply_method: ${[...byMethod].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(', ')}`);
if (fromText.length) console.log(`\nИз текста (проверь при скоринге):\n${fromText.map((s) => `- ${s}`).join('\n')}`);
if (changed && !dryRun) console.log('\nNEXT: npm run validate');
