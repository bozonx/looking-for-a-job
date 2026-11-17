import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');

export default defineNuxtConfig({
  compatibilityDate: '2026-11-01',
  srcDir: '.',
  ssr: false,
  devtools: { enabled: false },
  css: ['~/assets/main.css'],
  app: { head: { title: 'Вакансии', htmlAttrs: { lang: 'ru' } } },
  nitro: {
    replace: { 'process.env.JOB_ROOT': JSON.stringify(process.env.JOB_ROOT || root) },
  },
  vite: { server: { fs: { allow: [root] } } },
});
