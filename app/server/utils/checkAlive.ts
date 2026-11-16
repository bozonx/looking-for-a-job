/**
 * Фоновый запуск `npm run check-alive` из UI: один процесс за раз, состояние — в памяти сервера.
 * Скрипт сам пишет possibly_closed / alive_checked_at в файлы; UI видит это через обычное обновление списка.
 */
import { spawn } from 'node:child_process';
import { ROOT } from '../../../scripts/lib/env.ts';

export interface CheckAliveState {
  running: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  exitCode: number | null;
  /** «# ИТОГ ПРОВЕРКИ» (или хвост вывода при ошибке). */
  summary: string;
  /** Последняя строка вывода — для индикации прогресса. */
  last: string;
}

const state: CheckAliveState = { running: false, startedAt: null, finishedAt: null, exitCode: null, summary: '', last: '' };

export const checkAliveState = (): CheckAliveState => ({ ...state });

export function startCheckAlive(force: boolean): boolean {
  if (state.running) return false;
  Object.assign(state, { running: true, startedAt: new Date().toISOString(), finishedAt: null, exitCode: null, summary: '', last: 'запуск…' });
  const args = ['--env-file-if-exists=.env', 'scripts/check-alive.ts', ...(force ? ['--force'] : [])];
  const child = spawn(process.execPath, args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  const onData = (b: Buffer) => {
    out += b.toString();
    const lines = out.trimEnd().split('\n');
    state.last = lines[lines.length - 1] ?? '';
  };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  const done = (code: number | null) => {
    if (!state.running) return;
    const i = out.indexOf('# ИТОГ ПРОВЕРКИ');
    Object.assign(state, {
      running: false,
      finishedAt: new Date().toISOString(),
      exitCode: code,
      summary: (i >= 0 ? out.slice(i) : out.split('\n').slice(-10).join('\n')).trim(),
    });
  };
  child.on('close', done);
  child.on('error', (e) => {
    out += `\n${e.message}`;
    done(-1);
  });
  return true;
}
