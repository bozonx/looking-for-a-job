/**
 * Фаза A сбора: `npm run collect [-- <source>...] [--dry-run] [--limit N] [--file path.json]`.
 * Без источников — все из scripts/providers/index.ts. --file — только с одним источником.
 * Новые вакансии сохраняются со `scores: null` — их скорит агент (playbooks/scoring.md).
 */
import { collect } from './lib/collect.ts';
import { providers } from './providers/index.ts';

const args = process.argv.slice(2);
const flagValue = (name: string): string | undefined => {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const v = args[i + 1];
  if (v === undefined || v.startsWith('--')) throw new Error(`${name} требует значение`);
  args.splice(i, 2);
  return v;
};

async function main() {
  const limitRaw = flagValue('--limit');
  const file = flagValue('--file');
  const dryRun = args.includes('--dry-run');
  const names = args.filter((a) => !a.startsWith('--'));
  const unknownFlag = args.find((a) => a.startsWith('--') && a !== '--dry-run');
  if (unknownFlag) throw new Error(`Неизвестный флаг: ${unknownFlag}`);

  const limit = limitRaw === undefined ? Infinity : Number(limitRaw);
  if (!Number.isInteger(limit) && limit !== Infinity) throw new Error(`--limit: ожидается целое число, получено "${limitRaw}"`);
  if (limit < 1) throw new Error('--limit должен быть ≥ 1');

  const unknown = names.filter((n) => !providers[n]);
  if (unknown.length) throw new Error(`Неизвестный источник: ${unknown.join(', ')}. Доступны: ${Object.keys(providers).join(', ')}`);
  const list = names.length ? names : Object.keys(providers);
  if (file && list.length !== 1) throw new Error('--file работает только с одним источником');

  let total = 0;
  let failed = 0;
  for (const n of list) {
    const r = await collect(providers[n]!, { dryRun, limit, file });
    total += r.saved;
    if (r.failed) failed++;
  }
  if (total && !dryRun) console.log(`NEXT: отскорить ${total} вакансий (npm run pending), поискать real_url, затем npm run score && npm run validate; дописать data/insights.md`);
  if (failed) {
    console.error(`Источников с ошибкой загрузки: ${failed} (см. лог)`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(2);
});
