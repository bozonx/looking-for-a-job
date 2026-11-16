/**
 * Управление видимым Chromium через CDP (dev_docs/apply-plan.md §2). Браузер не запускает и не закрывает —
 * сначала `npm run browser:start`. Работает с активной (видимой) вкладкой; `--tab <n>` — выбрать по номеру из `tabs`.
 *
 *   npm run browser -- start                  запустить Chromium с профилем отклика (если ещё не запущен)
 *   npm run browser -- tabs                   список вкладок
 *   npm run browser -- open <url>             открыть в новой вкладке и сделать её активной
 *   npm run browser -- url                    URL и заголовок активной вкладки
 *   npm run browser -- snapshot [--all]       поля формы: ref, тип, метка, обязательность, значение, варианты;
 *                                             кнопки, капча, признаки логина. --all — и заполненные/скрытые поля
 *   npm run browser -- text [--max N]         видимый текст страницы (markdown-ish), по умолчанию 8000 символов
 *   npm run browser -- fill <ref> <text> [--type]   ввести текст (--type — посимвольно, TYPE_DELAY_MS)
 *   npm run browser -- select <ref> <вариант>  нативный select или кастомный комбобокс/автокомплит (ввод + выбор)
 *   npm run browser -- options <ref> [<поиск>] показать варианты кастомного комбобокса
 *   npm run browser -- check <ref> [--off]    чекбокс / радио
 *   npm run browser -- upload <ref> <file>    загрузить файл в input[type=file]
 *   npm run browser -- click <ref|"текст">    нажать (кнопки отправки заявки нажимать запрещено — см. ниже)
 *   npm run browser -- fill-many <plan.json>  пакетно: [{ "ref": "e0_3", "action": "fill|type|select|check|uncheck|upload", "value": "…" }]
 *                                             с паузами FILL_DELAY_MIN_MS…MAX между полями
 *   npm run browser -- screenshot [file] [--full]   PNG (по умолчанию data/state/screenshot.png)
 *   npm run browser -- wait-for <текст|css> [--timeout мс]
 *   npm run browser -- value <ref>            текущее значение поля
 *
 * Ref вида `e<кадр>_<n>` действует до перезагрузки страницы; после навигации — снова snapshot.
 * Защита: `click` отказывается нажимать то, что похоже на отправку заявки (Submit/Apply/Send/Отправить…),
 * если не передан `--i-am-human` (агенту этот флаг использовать нельзя — Submit нажимает пользователь).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { chromium, type Browser, type Frame, type Locator, type Page } from 'playwright-core';
import { DATA_DIR, env } from './lib/env.ts';

const argv = process.argv.slice(2);
const flag = (n: string) => argv.includes(n);
const opt = (n: string) => {
  const i = argv.indexOf(n);
  return i >= 0 ? argv[i + 1] : undefined;
};
const VALUE_FLAGS = new Set(['--tab', '--max', '--timeout']);
const pos = argv.filter((a, i) => !a.startsWith('--') && !VALUE_FLAGS.has(argv[i - 1] ?? ''));
const [cmd, ...rest] = pos;

const PROFILE = path.join(os.homedir(), '.local/share/job-apply-chromium');
/** Явная отправка; «Apply»/«Откликнуться» — только если это submit-кнопка формы (иначе она обычно открывает форму). */
const SUBMIT_RE = /(submit|send application|отправить|подать заявку|enviar|send$)/i;
const APPLY_RE = /^\s*(apply|откликн|postular|aplicar)/i;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rnd = (a: number, b: number) => a + Math.random() * Math.max(0, b - a);
const die = (msg: string): never => {
  console.error(`✗ ${msg}`);
  process.exit(1);
};

async function cdpAlive(): Promise<boolean> {
  try {
    const r = await fetch(`${env.BROWSER_CDP_URL}/json/version`, { signal: AbortSignal.timeout(1500) });
    return r.ok;
  } catch {
    return false;
  }
}

async function start(): Promise<void> {
  if (await cdpAlive()) return void console.log(`✓ браузер уже запущен (${env.BROWSER_CDP_URL})`);
  const bin = process.env.CHROMIUM_BIN || ['chromium', 'chromium-browser', 'google-chrome-stable', 'google-chrome'].find((b) => {
    try {
      return fs.existsSync(`/usr/bin/${b}`);
    } catch {
      return false;
    }
  });
  if (!bin) die('не найден chromium; укажите CHROMIUM_BIN');
  const port = new URL(env.BROWSER_CDP_URL).port || '9222';
  fs.mkdirSync(PROFILE, { recursive: true });
  const child = spawn(bin!, [`--user-data-dir=${PROFILE}`, `--remote-debugging-port=${port}`, '--no-first-run'], { detached: true, stdio: 'ignore' });
  child.unref();
  for (let i = 0; i < 40; i++) {
    await sleep(250);
    if (await cdpAlive()) return void console.log(`✓ запущен ${bin} · профиль ${PROFILE} · порт ${port}`);
  }
  die('браузер не ответил по CDP за 10 с');
}

async function connect(): Promise<Browser> {
  if (!(await cdpAlive())) die(`нет браузера на ${env.BROWSER_CDP_URL} — запустите \`npm run browser:start\``);
  return chromium.connectOverCDP(env.BROWSER_CDP_URL);
}

function pages(b: Browser): Page[] {
  return b.contexts().flatMap((c) => c.pages()).filter((p) => !p.url().startsWith('devtools://'));
}

async function activePage(b: Browser): Promise<Page> {
  const ps = pages(b);
  if (!ps.length) die('нет открытых вкладок');
  const tab = opt('--tab');
  if (tab !== undefined) return ps[Number(tab)] ?? die(`нет вкладки ${tab}`);
  // последняя вкладка агента, если она на виду (пользователь не переключился)
  const last = readLast();
  const byLast = last ? ps.filter((p) => p.url() === last).at(-1) : undefined;
  const isVisible = (p: Page) => p.evaluate(() => document.visibilityState === 'visible').catch(() => false);
  if (byLast && (await isVisible(byLast))) return byLast;
  for (const p of ps) if (await p.evaluate(() => document.visibilityState === 'visible' && document.hasFocus()).catch(() => false)) return p;
  if (byLast) return byLast;
  const visible = [];
  for (const p of ps) if (await p.evaluate(() => document.visibilityState === 'visible').catch(() => false)) visible.push(p);
  return visible.at(-1) ?? ps.at(-1)!;
}

const LAST_FILE = path.join(DATA_DIR, 'state', 'browser-last-tab.txt');
function readLast(): string | null {
  try {
    return fs.readFileSync(LAST_FILE, 'utf8').trim() || null;
  } catch {
    return null;
  }
}
function writeLast(url: string): void {
  fs.mkdirSync(path.dirname(LAST_FILE), { recursive: true });
  fs.writeFileSync(LAST_FILE, url);
}

// ---------- snapshot (выполняется в странице) ----------

interface Field {
  ref: string;
  kind: string;
  label: string;
  required: boolean;
  value: string;
  options?: { ref?: string; label: string; checked?: boolean }[];
  hint?: string;
  hidden?: boolean;
}
interface FrameSnap {
  fields: Field[];
  buttons: { ref: string; text: string }[];
  captcha: string[];
  login: boolean;
  title: string;
}

/** Сериализуется в страницу: никаких замыканий на внешние переменные. */
function collect(frameIdx: number): FrameSnap {
  const doc = document;
  let n = 0;
  const ref = (el: Element) => {
    let r = el.getAttribute('data-jref');
    if (!r) {
      r = `e${frameIdx}_${n}`;
      el.setAttribute('data-jref', r);
    }
    n++;
    return r;
  };
  // продолжить нумерацию после уже выданных ref (повторный snapshot не меняет старые)
  doc.querySelectorAll('[data-jref]').forEach((el) => {
    const m = /_(\d+)$/.exec(el.getAttribute('data-jref') || '');
    if (m) n = Math.max(n, Number(m[1]) + 1);
  });
  const clean = (s: string | null | undefined) => (s || '').replace(/\s+/g, ' ').trim();
  const visible = (el: Element) => {
    const h = el as HTMLElement;
    const r = h.getBoundingClientRect();
    const st = getComputedStyle(h);
    return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none';
  };
  const GENERIC = /^(attach|upload|upload file|choose file|select file|browse|drop files? here|enter manually|dropbox|google drive|прикрепить|загрузить|выбрать файл|adjuntar|subir archivo)$/i;
  const good = (t: string) => !!t && !GENERIC.test(t);
  const labelOf = (el: Element): string => {
    const by = el.getAttribute('aria-labelledby');
    if (by) {
      const t = by.split(/\s+/).map((id) => clean(doc.getElementById(id)?.textContent)).join(' ');
      if (t) return t;
    }
    const id = el.id;
    if (id) {
      const l = doc.querySelector(`label[for="${CSS.escape(id)}"]`);
      if (l && good(clean(l.textContent))) return clean(l.textContent);
    }
    const wrap = el.closest('label');
    if (wrap && good(clean(wrap.textContent))) return clean(wrap.textContent);
    const al = el.getAttribute('aria-label');
    if (al && good(clean(al))) return clean(al);
    // ближайший предшествующий текст в контейнере поля (Greenhouse/Ashby/Lever)
    let p: Element | null = el.parentElement;
    for (let i = 0; i < 6 && p; i++, p = p.parentElement) {
      const ls = p.querySelectorAll('label, legend, [class*="label" i], [class*="question" i], [id$="label" i]');
      for (const l of ls) if (!l.contains(el) && good(clean(l.textContent)) && clean(l.textContent).length < 300) return clean(l.textContent);
    }
    return clean(el.getAttribute('placeholder') || el.getAttribute('name') || '');
  };
  const groupLabel = (el: Element): string => {
    const fs = el.closest('fieldset');
    const lg = fs?.querySelector('legend');
    if (lg && clean(lg.textContent)) return clean(lg.textContent);
    const rg = el.closest('[role="radiogroup"], [role="group"]');
    if (rg) {
      const t = rg.getAttribute('aria-label') || clean(doc.getElementById(rg.getAttribute('aria-labelledby') || '')?.textContent);
      if (t) return t;
    }
    let p: Element | null = el.parentElement;
    for (let i = 0; i < 6 && p; i++, p = p.parentElement) {
      const l = p.querySelector(':scope > label, :scope > legend, :scope > [class*="label" i], :scope > [class*="question" i]');
      if (l && !l.contains(el) && clean(l.textContent)) return clean(l.textContent);
    }
    return el.getAttribute('name') || '';
  };
  const isReq = (el: Element, label: string) =>
    (el as HTMLInputElement).required || el.getAttribute('aria-required') === 'true' || /\*\s*$|\*\s|\(required\)|обязательн/i.test(label);

  const fields: Field[] = [];
  const groups = new Map<string, Field>();
  const els = doc.querySelectorAll('input, textarea, select, [role="combobox"], [contenteditable="true"]');
  els.forEach((el) => {
    const tag = el.tagName.toLowerCase();
    const type = ((el as HTMLInputElement).type || '').toLowerCase();
    if (tag === 'input' && ['hidden', 'submit', 'button', 'reset', 'image'].includes(type)) return;
    // служебные скрытые input (react-select requiredInput и т.п.)
    if (el.getAttribute('aria-hidden') === 'true' && el.getAttribute('tabindex') === '-1' && type !== 'file') return;
    // input внутри комбобокса уже описан комбобоксом
    if (tag === 'input' && el.getAttribute('role') !== 'combobox' && el.closest('[role="combobox"]')) return;
    const vis = visible(el);
    if (type === 'radio' || type === 'checkbox') {
      const optLabel = labelOf(el);
      const name = (el as HTMLInputElement).name;
      const checked = (el as HTMLInputElement).checked;
      const key = type === 'radio' && name ? `radio:${name}` : '';
      if (key) {
        let g = groups.get(key);
        if (!g) {
          const gl = groupLabel(el);
          g = { ref: '', kind: 'radio', label: gl, required: isReq(el, gl), value: '', options: [] };
          groups.set(key, g);
          fields.push(g);
        }
        g.options!.push({ ref: ref(el), label: optLabel, checked });
        if (checked) g.value = optLabel;
        if (!vis && !visible(el.closest('label') || el)) g.hidden = true;
        return;
      }
      const gl = groupLabel(el);
      fields.push({ ref: ref(el), kind: 'checkbox', label: optLabel, required: isReq(el, optLabel), value: checked ? 'checked' : '', hint: gl && gl !== optLabel ? gl : undefined, hidden: !vis && !visible(el.closest('label') || el) });
      return;
    }
    const label = labelOf(el);
    if (tag === 'select') {
      const s = el as HTMLSelectElement;
      fields.push({ ref: ref(el), kind: 'select', label, required: isReq(el, label), value: clean(s.selectedOptions[0]?.textContent), options: [...s.options].map((o) => ({ label: clean(o.textContent) })).filter((o) => o.label), hidden: !vis });
      return;
    }
    if (el.getAttribute('role') === 'combobox') {
      let shown = '';
      let c: Element | null = el.parentElement;
      for (let i = 0; i < 5 && c && !shown; i++, c = c.parentElement) {
        shown = clean(c.querySelector('[class*="single-value" i], [class*="singleValue" i], [class*="multi-value" i], [class*="selected-value" i]')?.textContent);
      }
      shown ||= (el as HTMLInputElement).value || '';
      fields.push({ ref: ref(el), kind: 'combobox', label, required: isReq(el, label), value: clean(shown), hidden: !vis });
      return;
    }
    if (type === 'file') {
      const f = el as HTMLInputElement;
      let fileVal = [...(f.files || [])].map((x) => x.name).join(', ');
      // ATS часто показывает загруженный файл текстом рядом, а сам input очищает
      for (let i = 0, c: Element | null = el.parentElement; i < 5 && c && !fileVal; i++, c = c.parentElement) {
        const m = /[\w ()\-.]+\.(pdf|docx?|rtf|txt|odt)\b/i.exec(clean((c as HTMLElement).innerText));
        if (m) fileVal = m[0].trim();
      }
      fields.push({ ref: ref(el), kind: 'file', label, required: isReq(el, label), value: fileVal, hint: f.accept ? (f.accept.length > 50 ? f.accept.slice(0, 47) + '…' : f.accept) : undefined, hidden: !vis });
      return;
    }
    const v = (el as HTMLInputElement).value ?? (el as HTMLElement).innerText;
    const max = (el as HTMLInputElement).maxLength;
    fields.push({ ref: ref(el), kind: tag === 'textarea' || el.getAttribute('contenteditable') ? 'textarea' : type || 'text', label, required: isReq(el, label), value: clean(v).slice(0, 200), hint: max > 0 ? `max ${max}` : undefined, hidden: !vis });
  });

  const buttons: { ref: string; text: string }[] = [];
  doc.querySelectorAll('button, [role="button"], input[type="submit"], a[class*="button" i], a[class*="btn" i]').forEach((el) => {
    if (!visible(el)) return;
    const t = clean((el as HTMLInputElement).value || el.textContent || el.getAttribute('aria-label'));
    if (!t || t.length >= 60 || /^(toggle flyout|locate me|dropbox|google drive|clear|remove|×)$/i.test(t)) return;
    // кнопки-ответы (Yes/No в Ashby и т.п.): показать вопрос, к которому относятся
    const q = /^(yes|no|да|нет|sí|si)$/i.test(t) ? groupLabel(el) : '';
    buttons.push({ ref: ref(el), text: q ? `${t}» ← «${q}` : t });
  });

  const captcha: string[] = [];
  doc.querySelectorAll('iframe').forEach((f) => {
    const s = f.src || '';
    if (/recaptcha/.test(s)) captcha.push(/invisible|size=invisible/.test(s) || !visible(f) ? 'reCAPTCHA (невидимая)' : 'reCAPTCHA');
    else if (/hcaptcha/.test(s)) captcha.push('hCaptcha');
    else if (/challenges\.cloudflare|turnstile/.test(s)) captcha.push('Cloudflare Turnstile');
  });
  if (doc.querySelector('.g-recaptcha, [data-sitekey]') && !captcha.length) captcha.push('captcha-виджет');
  if (/just a moment|checking your browser|verify you are human/i.test(doc.title + ' ' + clean(doc.body?.innerText).slice(0, 500))) captcha.push('челлендж на странице');

  const pw = doc.querySelector('input[type="password"]');
  const login = !!pw && visible(pw);
  return { fields, buttons, captcha: [...new Set(captcha)], login, title: doc.title };
}

async function snapshot(page: Page): Promise<void> {
  const showAll = flag('--all');
  console.log(`# ${await page.title()}\n${page.url()}\n`);
  const frames = page.frames();
  let total = 0;
  for (let i = 0; i < frames.length; i++) {
    const fr = frames[i]!;
    if (/recaptcha|hcaptcha|turnstile|challenges\.cloudflare/.test(fr.url())) continue;
    let s: FrameSnap;
    try {
      s = await fr.evaluate(collect, i);
    } catch {
      continue;
    }
    const fields = s.fields.filter((f) => showAll || !f.hidden);
    if (!fields.length && !s.captcha.length && !s.login && i > 0) continue;
    if (i > 0) console.log(`\n## кадр ${i}: ${fr.url()}`);
    if (s.login) console.log('⚠ на странице поле пароля — похоже на вход/регистрацию');
    if (s.captcha.length) console.log(`⚠ капча: ${s.captcha.join(', ')}`);
    for (const f of fields) {
      total++;
      const req = f.required ? '*' : ' ';
      const val = f.value ? ` = «${f.value}»` : '';
      const hint = f.hint ? ` (${f.hint})` : '';
      const hid = f.hidden ? ' [скрыто]' : '';
      console.log(`${req} ${f.ref || '—'.padEnd(6)} ${f.kind.padEnd(9)} ${f.label || '(без метки)'}${hint}${val}${hid}`);
      if (f.options) {
        const shown = f.options.slice(0, 40);
        for (const o of shown) console.log(`      ${o.ref ? o.ref.padEnd(7) : '·      '} ${o.checked ? '◉' : '○'} ${o.label}`);
        if (f.options.length > shown.length) console.log(`      … ещё ${f.options.length - shown.length}`);
      }
    }
    if (s.buttons.length) console.log(`\nкнопки: ${s.buttons.map((b) => `${b.ref} «${b.text}»`).join(' · ')}`);
  }
  if (!total) console.log('(полей формы не найдено — возможно, нужно нажать «Apply» или форма в другом кадре/вкладке)');
  console.log('\n* — обязательное. Ref действуют до перезагрузки страницы.');
}

async function find(page: Page, r: string): Promise<{ loc: Locator; frame: Frame }> {
  for (const fr of page.frames()) {
    const loc = fr.locator(`[data-jref="${r}"]`);
    if (await loc.count().catch(() => 0)) return { loc: loc.first(), frame: fr };
  }
  return die(`ref ${r} не найден — сделайте snapshot заново`);
}

async function doFill(page: Page, r: string, text: string, type: boolean): Promise<void> {
  const { loc } = await find(page, r);
  await loc.scrollIntoViewIfNeeded().catch(() => {});
  if (type) {
    await loc.click();
    await loc.fill('');
    await loc.pressSequentially(text, { delay: env.TYPE_DELAY_MS });
  } else {
    await loc.fill(text);
  }
  await loc.blur().catch(() => {});
}

/** Видимые варианты открытого комбобокса/автокомплита. */
async function visibleOptions(page: Page): Promise<Locator[]> {
  const out: Locator[] = [];
  for (const fr of page.frames()) {
    const opts = fr.locator('[role="option"], [class*="option" i]:not([class*="options" i]) , li[class*="suggestion" i]');
    const n = await opts.count().catch(() => 0);
    for (let i = 0; i < n; i++) if (await opts.nth(i).isVisible().catch(() => false)) out.push(opts.nth(i));
  }
  return out;
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

async function doSelect(page: Page, r: string, value: string): Promise<string> {
  const { loc } = await find(page, r);
  await loc.scrollIntoViewIfNeeded().catch(() => {});
  const tag = await loc.evaluate((e) => e.tagName.toLowerCase());
  if (tag === 'select') {
    const labels = await loc.evaluate((e) => [...(e as HTMLSelectElement).options].map((o) => o.textContent?.trim() || ''));
    const hit = labels.find((l) => norm(l) === norm(value)) ?? labels.find((l) => norm(l).includes(norm(value)));
    if (!hit) die(`нет варианта «${value}»; есть: ${labels.filter(Boolean).join(' | ')}`);
    await loc.selectOption({ label: hit! });
    return hit!;
  }
  // кастомный: открыть, ввести текст (если поле вводимое), выбрать вариант
  await loc.click();
  const editable = await loc.evaluate((e) => e.tagName === 'INPUT' || (e as HTMLElement).isContentEditable);
  if (editable) {
    await loc.fill('').catch(() => {});
    await loc.pressSequentially(value, { delay: env.TYPE_DELAY_MS });
  }
  let opts: Locator[] = [];
  for (let i = 0; i < 20 && !opts.length; i++) {
    await sleep(250);
    opts = await visibleOptions(page);
  }
  if (!opts.length) die(`варианты не появились для «${value}»`);
  const texts = await Promise.all(opts.map((o) => o.innerText().catch(() => '')));
  let idx = texts.findIndex((t) => norm(t) === norm(value));
  if (idx < 0) idx = texts.findIndex((t) => norm(t).startsWith(norm(value)));
  if (idx < 0) idx = texts.findIndex((t) => norm(t).includes(norm(value)));
  if (idx < 0) {
    await page.keyboard.press('Escape').catch(() => {});
    die(`нет варианта «${value}»; видны: ${texts.slice(0, 20).map((t) => t.trim()).join(' | ')}`);
  }
  await opts[idx]!.click();
  return texts[idx]!.trim();
}

async function doCheck(page: Page, r: string, on: boolean): Promise<void> {
  const { loc } = await find(page, r);
  await loc.scrollIntoViewIfNeeded().catch(() => {});
  try {
    await loc.setChecked(on, { timeout: 3000 });
  } catch {
    // стилизованный чекбокс: input скрыт — кликаем по label
    const cur = await loc.isChecked().catch(() => !on);
    if (cur !== on) await loc.evaluate((e) => ((e.closest('label') as HTMLElement | null) ?? (e as HTMLElement)).click());
  }
}

async function doUpload(page: Page, r: string, file: string): Promise<void> {
  const abs = path.resolve(file);
  if (!fs.existsSync(abs)) die(`нет файла ${abs}`);
  const { loc } = await find(page, r);
  await loc.setInputFiles(abs);
}

async function doClick(page: Page, target: string): Promise<void> {
  let loc: Locator;
  if (/^e\d+_\d+$/.test(target)) loc = (await find(page, target)).loc;
  else loc = page.getByRole('button', { name: target }).or(page.getByText(target, { exact: false })).first();
  const text = ((await loc.innerText().catch(() => '')) || (await loc.getAttribute('value').catch(() => '')) || target).trim();
  const isSubmitType = await loc.evaluate((e) => (e as HTMLButtonElement).type === 'submit' && !!e.closest('form')).catch(() => false);
  if ((SUBMIT_RE.test(text) || (isSubmitType && APPLY_RE.test(text))) && !flag('--i-am-human')) {
    die(`«${text}» похоже на отправку заявки — её нажимает пользователь`);
  }
  await loc.scrollIntoViewIfNeeded().catch(() => {});
  await loc.click();
  console.log(`✓ нажато «${text}»`);
}

async function pageText(page: Page): Promise<string> {
  const parts: string[] = [];
  for (const fr of page.frames()) {
    const t = await fr.evaluate(() => document.body?.innerText || '').catch(() => '');
    if (t.trim()) parts.push(t);
  }
  return parts.join('\n\n---\n\n').replace(/\n{3,}/g, '\n\n');
}

interface PlanStep {
  ref: string;
  action?: 'fill' | 'type' | 'select' | 'check' | 'uncheck' | 'upload';
  value?: string;
}

async function main(): Promise<void> {
  if (!cmd || cmd === 'help') {
    console.log(fs.readFileSync(import.meta.filename, 'utf8').split('*/')[0]);
    return;
  }
  if (cmd === 'start') return start();
  const b = await connect();
  try {
    if (cmd === 'tabs') {
      pages(b).forEach((p, i) => console.log(`${i}\t${p.url()}`));
      return;
    }
    if (cmd === 'open') {
      const url = rest[0] ?? die('нужен url');
      const ctx = b.contexts()[0] ?? die('нет контекста браузера');
      const p = await ctx.newPage();
      await p.goto(url!, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await p.bringToFront();
      await p.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
      writeLast(p.url());
      console.log(`✓ ${await p.title()}\n${p.url()}`);
      return;
    }
    const page = await activePage(b);
    await page.bringToFront().catch(() => {});
    switch (cmd) {
      case 'url':
        console.log(`${await page.title()}\n${page.url()}`);
        break;
      case 'snapshot':
        await snapshot(page);
        break;
      case 'text': {
        const max = Number(opt('--max') ?? 8000);
        const t = await pageText(page);
        console.log(t.slice(0, max) + (t.length > max ? `\n… (обрезано, всего ${t.length})` : ''));
        break;
      }
      case 'fill':
        await doFill(page, rest[0] ?? die('нужен ref'), rest.slice(1).join(' '), flag('--type'));
        console.log(`✓ ${rest[0]}`);
        break;
      case 'select':
        console.log(`✓ ${rest[0]} → «${await doSelect(page, rest[0] ?? die('нужен ref'), rest.slice(1).join(' '))}»`);
        break;
      case 'options': {
        const { loc } = await find(page, rest[0] ?? die('нужен ref'));
        await loc.click();
        if (rest[1]) await loc.pressSequentially(rest.slice(1).join(' '), { delay: env.TYPE_DELAY_MS }).catch(() => {});
        await sleep(800);
        const opts = await visibleOptions(page);
        for (const o of opts.slice(0, 50)) console.log(`○ ${(await o.innerText().catch(() => '')).trim()}`);
        if (!opts.length) console.log('(вариантов не видно)');
        await page.keyboard.press('Escape').catch(() => {});
        break;
      }
      case 'check':
        await doCheck(page, rest[0] ?? die('нужен ref'), !flag('--off'));
        console.log(`✓ ${rest[0]} ${flag('--off') ? 'снят' : 'отмечен'}`);
        break;
      case 'upload':
        await doUpload(page, rest[0] ?? die('нужен ref'), rest[1] ?? die('нужен файл'));
        console.log(`✓ загружен ${path.basename(rest[1]!)}`);
        break;
      case 'click':
        await doClick(page, rest.join(' ') || die('нужен ref или текст'));
        break;
      case 'value': {
        const { loc } = await find(page, rest[0] ?? die('нужен ref'));
        console.log(await loc.evaluate((e) => (e as HTMLInputElement).value ?? (e as HTMLElement).innerText));
        break;
      }
      case 'fill-many': {
        const plan = JSON.parse(fs.readFileSync(rest[0] ?? die('нужен plan.json'), 'utf8')) as PlanStep[];
        let ok = 0;
        const failed: string[] = [];
        for (const s of plan) {
          try {
            const a = s.action ?? 'fill';
            if (a === 'fill' || a === 'type') await doFill(page, s.ref, s.value ?? '', a === 'type');
            else if (a === 'select') await doSelect(page, s.ref, s.value ?? '');
            else if (a === 'check' || a === 'uncheck') await doCheck(page, s.ref, a === 'check');
            else if (a === 'upload') await doUpload(page, s.ref, s.value ?? '');
            ok++;
            console.log(`✓ ${s.ref} ${a}`);
          } catch (e) {
            failed.push(s.ref);
            console.log(`✗ ${s.ref}: ${(e as Error).message.split('\n')[0]}`);
          }
          await sleep(rnd(env.FILL_DELAY_MIN_MS, env.FILL_DELAY_MAX_MS));
        }
        console.log(`\nготово ${ok}/${plan.length}${failed.length ? ` · ошибки: ${failed.join(', ')}` : ''}`);
        break;
      }
      case 'screenshot': {
        const file = rest[0] ?? path.join(DATA_DIR, 'state', 'screenshot.png');
        fs.mkdirSync(path.dirname(file), { recursive: true });
        await page.screenshot({ path: file, fullPage: flag('--full') });
        console.log(`✓ ${file}`);
        break;
      }
      case 'wait-for': {
        const what = rest.join(' ') || die('нужен текст или селектор');
        const timeout = Number(opt('--timeout') ?? 15000);
        const loc = /^[.#\[]|^[a-z]+[.#\[]/i.test(what) ? page.locator(what) : page.getByText(what);
        await loc.first().waitFor({ state: 'visible', timeout });
        console.log(`✓ появилось: ${what}`);
        break;
      }
      default:
        die(`неизвестная команда ${cmd}; см. npm run browser -- help`);
    }
    writeLast(page.url());
  } finally {
    // для connectOverCDP close() только отключается; сам браузер и вкладки остаются
    await b.close().catch(() => {});
  }
}

main().catch((e) => die((e as Error).message.split('\n')[0]!));
