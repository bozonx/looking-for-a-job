/**
 * Аргентинские площадки (без ключа, без браузера):
 * - Bumeran и ZonaJobs — одна платформа (Jobint): JSON API POST /api/avisos/searchV2, сайт задаётся
 *   заголовком x-site-id (BMAR / ZJAR). Пулы вакансий у сайтов разные. Описание — уже в выдаче (простой текст).
 * - Computrabajo — HTML: список /empleos-de-<категория>?p=N (карточки <article class="box_offer">),
 *   полное описание — schema.org JobPosting на странице вакансии (грузится лениво, после предфильтра).
 * Настройки — config/sources.yaml (секции bumeran, zonajobs, computrabajo).
 */
import { fetchJson, fetchText, warn } from '../lib/http.ts';
import { decodeEntities, makeJob, normEmployment, sourceConfig } from '../lib/job.ts';
import { jobPosting } from '../lib/jsonld.ts';
import { htmlToMarkdown } from '../lib/html.ts';
import type { Provider, RawJob } from '../lib/collect.ts';

const byDate = (a: RawJob, b: RawJob) => (b.postedAt ?? 0) - (a.postedAt ?? 0);

/** Простой текст (с \n) → HTML для htmlToMarkdown, чтобы не потерять переводы строк. */
const textToHtml = (s: string) =>
  decodeEntities(s.replace(/\r?\n/g, ' \u0000 '))
    .split('\u0000')
    .map((l) => l.trim())
    .map((l) => l.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'))
    .join('<br>');

/* ---------------- Bumeran / ZonaJobs ---------------- */

interface JobintConfig {
  /** фильтры поиска как в URL сайта, например { id: area, value: tecnologia-sistemas-y-telecomunicaciones } */
  filters?: { id: string; value: string }[];
  query?: string;
}

const JOBINT_PAGE = 20;

/** «16-11-2026 12:33:02» (время Аргентины, UTC−3) → мс */
function jobintDate(s: string | null | undefined): number | null {
  const m = String(s ?? '').match(/^(\d{2})-(\d{2})-(\d{4})(?: (\d{2}):(\d{2}):(\d{2}))?/);
  if (!m) return null;
  const t = Date.parse(`${m[3]}-${m[2]}-${m[1]}T${m[4] ?? '12'}:${m[5] ?? '00'}:${m[6] ?? '00'}-03:00`);
  return Number.isFinite(t) ? t : null;
}

function jobintProvider(source: 'bumeran' | 'zonajobs', name: string, origin: string, siteId: string): Provider {
  const parse = (input: unknown): RawJob[] => {
    const list = (input as any)?.content;
    if (!Array.isArray(list)) throw new Error(`${name} API: нет content (сменился API?)`);
    return list
      .filter((j: any) => j.id && j.titulo)
      .map((j: any) => {
        const remote = /remot/i.test(j.modalidadTrabajo ?? '');
        return makeJob({
          extId: j.id,
          postedAt: jobintDate(j.fechaHoraPublicacion ?? j.fechaPublicacion),
          title: j.titulo,
          company: j.confidencial || !j.empresa ? 'Confidencial' : j.empresa,
          tags: [],
          sourceName: name,
          sourceUrl: `${origin}/empleos/${j.id}.html`,
          location: [remote ? 'Remote' : null, j.localizacion, 'Argentina'].filter(Boolean).join('; '),
          employment: normEmployment(j.tipoTrabajo),
          extra: { Modalidad: j.modalidadTrabajo, Jornada: j.tipoTrabajo, Vacantes: j.cantidadVacantes },
          html: textToHtml(String(j.detalle ?? '')),
        });
      })
      .sort(byDate);
  };
  return {
    source,
    paginated: true,
    parse,
    async fetchPage(page) {
      const cfg = sourceConfig<JobintConfig>(source) ?? {};
      const body: Record<string, unknown> = { filtros: cfg.filters ?? [{ id: 'area', value: 'tecnologia-sistemas-y-telecomunicaciones' }] };
      if (cfg.query) body.query = cfg.query;
      return parse(
        await fetchJson(`${origin}/api/avisos/searchV2?pageSize=${JOBINT_PAGE}&page=${page}&sort=RECIENTES`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-site-id': siteId, referer: `${origin}/`, origin },
          body: JSON.stringify(body),
        }),
      );
    },
  };
}

export const bumeran = jobintProvider('bumeran', 'Bumeran', 'https://www.bumeran.com.ar', 'BMAR');
export const zonajobs = jobintProvider('zonajobs', 'ZonaJobs', 'https://www.zonajobs.com.ar', 'ZJAR');

/* ---------------- Computrabajo ---------------- */

const CT = 'https://ar.computrabajo.com';

/** «Hace 7 horas» / «Ayer» / «Hace más de 30 días» → примерное время публикации, мс */
function ctAgo(s: string): number | null {
  const t = decodeEntities(s).toLowerCase();
  if (/más de 30/.test(t)) return Date.now() - 31 * 86400e3;
  if (/ayer/.test(t)) return Date.now() - 86400e3;
  const m = t.match(/(\d+)\s*(minuto|hora|día|dia|semana|mes)/);
  if (!m) return null;
  const unit = { minuto: 60e3, hora: 3600e3, día: 86400e3, dia: 86400e3, semana: 7 * 86400e3, mes: 30 * 86400e3 }[m[2] as 'hora'];
  return Date.now() - Number(m[1]) * unit;
}

function ctParse(input: unknown): RawJob[] {
  if (typeof input !== 'string') throw new Error('Computrabajo: ожидался HTML');
  const out: RawJob[] = [];
  for (const m of input.matchAll(/<article class="box_offer[^"]*"[^>]*data-id='([A-F0-9]+)'[\s\S]*?<\/article>/g)) {
    const a = m[0];
    const id = m[1]!;
    const link = a.match(/href="(\/ofertas-de-trabajo\/[^"#]+)/)?.[1];
    const title = a.match(/class="js-o-link[^"]*"[^>]*>([\s\S]*?)<\/a>/)?.[1];
    if (!link || !title) continue;
    const company = a.match(/offer-grid-article-company-url[^>]*>([\s\S]*?)<\/a>/)?.[1];
    const loc = a.match(/<p class="fs16 fc_base mt5">\s*<span class="mr10">([\s\S]*?)<\/span>/)?.[1];
    const ago = a.match(/<p class="fs13 fc_aux mt15">([\s\S]*?)<\/p>/)?.[1] ?? '';
    const url = `${CT}${link}`;
    const location = loc ? `${decodeEntities(loc)}, Argentina` : 'Argentina';
    const job = makeJob({ extId: id, postedAt: ctAgo(ago), title, company: company ?? 'Unknown', sourceName: 'Computrabajo', sourceUrl: url, location, html: '' });
    const short = job.build;
    // описание — со страницы вакансии (JobPosting), только для прошедших предфильтр
    job.build = async () => {
      const base = await short();
      try {
        const jp = jobPosting(await fetchText(url));
        if (!jp?.description) {
          warn(`computrabajo: на странице ${url} нет JobPosting с описанием`);
          return base;
        }
        const desc = /<\w+[^>]*>/.test(jp.description) ? jp.description : textToHtml(jp.description);
        const head = base.body.split('\n\n').slice(0, 2).join('\n\n');
        return {
          data: {
            ...base.data,
            location: jp.remote ? `Remote; ${location}` : location,
            employment: jp.employment,
            posted_at: jp.datePosted ? String(jp.datePosted).slice(0, 10) : base.data.posted_at,
          },
          body: `${head}\n\n- **Location:** ${jp.location ?? location}\n\n${htmlToMarkdown(desc)}\n`,
        };
      } catch (e) {
        warn(`computrabajo: страница ${url} не загрузилась (${(e as Error).message})`);
        return base;
      }
    };
    out.push(job);
  }
  return out;
}

export const computrabajo: Provider = {
  source: 'computrabajo',
  paginated: true,
  parse: ctParse,
  async fetchPage(page) {
    const paths = sourceConfig<{ pages?: string[] }>('computrabajo')?.pages ?? ['/empleos-de-informatica-y-telecom'];
    const all = new Map<string, RawJob>();
    for (const p of paths) {
      const html = await fetchText(`${CT}${p}${p.includes('?') ? '&' : '?'}p=${page + 1}`);
      const jobs = ctParse(html);
      if (!jobs.length && page === 0 && !/box_offer/.test(html)) throw new Error(`Computrabajo ${p}: нет карточек вакансий (сменилась вёрстка?)`);
      for (const j of jobs) all.set(j.extId, j);
    }
    return [...all.values()].sort(byDate);
  },
};
