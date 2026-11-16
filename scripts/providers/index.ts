/** Реестр провайдеров сбора. Новый источник: scripts/providers/<id>.ts + строка здесь + config/sources.md. */
import type { Provider } from '../lib/collect.ts';
import { remoteok } from './remoteok.ts';

export const providers: Record<string, Provider> = { remoteok };
