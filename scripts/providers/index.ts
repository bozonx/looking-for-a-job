/**
 * Реестр провайдеров сбора. Новый источник: scripts/providers/<id>.ts + строка здесь + config/sources.md
 * и config/apply-priority.yaml. Стандартные ленты (RSS/Atom/JSON Feed) добавляются без кода —
 * секция `feeds` в config/sources.yaml.
 */
import type { Provider } from '../lib/collect.ts';
import { remoteok } from './remoteok.ts';
import { ats } from './ats.ts';
import { getonbrd } from './getonbrd.ts';
import { hn } from './hn.ts';
import { himalayas, jobicy, remotive } from './remote-boards.ts';
import { landingjobs, workingnomads, yc } from './more-boards.ts';
import { bumeran, computrabajo, zonajobs } from './argentina.ts';
import { geekjob, getmatch, hh } from './cis.ts';
import { feedProviders } from './feed.ts';

export const providers: Record<string, Provider> = { ats, getonbrd, hn, remoteok, himalayas, jobicy, remotive, workingnomads, landingjobs, yc, bumeran, zonajobs, computrabajo, hh, getmatch, geekjob, ...feedProviders() };
