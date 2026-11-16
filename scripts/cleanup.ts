/**
 * Удаление старых вакансий без решения (логика — scripts/lib/cleanup.ts).
 * `npm run cleanup -- [--older-than 30d] [--dry-run]`
 * По умолчанию возраст — CLEANUP_DEFAULT_DAYS. Также запускается после `npm run collect`, если CLEANUP_ON_COLLECT=true.
 */
import { env } from './lib/env.ts';
import { cleanup } from './lib/cleanup.ts';

const args = process.argv.slice(2);
const i = args.indexOf('--older-than');
const ageRaw = i >= 0 ? args[i + 1] : `${env.CLEANUP_DEFAULT_DAYS}d`;
const m = /^(\d+)d?$/.exec(ageRaw ?? '');
if (!m) {
  console.error(`--older-than: ожидается "<N>d", получено "${ageRaw}"`);
  process.exit(2);
}
cleanup(Number(m[1]), args.includes('--dry-run'));
