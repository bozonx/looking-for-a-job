/**
 * Защита от двух одновременных запусков одной команды (data/state/<name>.lock с pid).
 * Lock-файл от упавшего процесса (pid уже не жив) перехватывается.
 */
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './env.ts';

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
};

export function acquireLock(name: string): void {
  const file = path.join(DATA_DIR, 'state', `${name}.lock`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      fs.writeFileSync(file, String(process.pid), { flag: 'wx' });
      const release = () => {
        try {
          if (fs.readFileSync(file, 'utf8') === String(process.pid)) fs.unlinkSync(file);
        } catch {}
      };
      process.on('exit', release);
      for (const sig of ['SIGINT', 'SIGTERM'] as const) process.once(sig, () => process.exit(130));
      return;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      const pid = Number(fs.readFileSync(file, 'utf8'));
      if (Number.isInteger(pid) && pid > 0 && alive(pid)) throw new Error(`${name} уже запущен (pid ${pid}); если это не так — удали ${file}`);
      fs.rmSync(file, { force: true }); // осиротевший lock
    }
  }
  throw new Error(`не удалось взять блокировку ${file}`);
}
