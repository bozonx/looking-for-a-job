import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../../../scripts/lib/env.ts';
export default defineEventHandler(() => {
  const file = path.join(DATA_DIR, 'insights.md');
  const lines = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n') : [];
  return { openInsights: lines.filter(l => /^- \[(filter|scoring|source|bug)\]/.test(l) && !/\((сделано|исправлено[^)]*)\)/i.test(l)).length };
});
