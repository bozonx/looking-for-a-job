<script setup lang="ts">
import { marked } from 'marked';

/** Оригинальный текст вакансии (markdown со стороннего сайта), свёрнут по умолчанию. */
const props = defineProps<{ body: string }>();
const open = ref(false);

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
// Сырой HTML экранируется, ссылки открываются в новой вкладке.
const renderer = new marked.Renderer();
renderer.html = ({ text }) => escapeHtml(text);
renderer.link = ({ href, text }) =>
  /^https?:|^mailto:/i.test(href) ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(text)}</a>` : escapeHtml(text);
// Сторонние картинки не грузим (трекинг-пиксели): показываем ссылкой.
renderer.image = ({ href, text }) =>
  /^https?:/i.test(href) ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">[изображение${text ? `: ${escapeHtml(text)}` : ''}]</a>` : '';
const html = computed(() => (open.value ? (marked.parse(props.body, { renderer, async: false }) as string) : ''));
</script>

<template>
  <section>
    <button class="ghost" @click="open = !open">{{ open ? '▾' : '▸' }} Оригинальный текст</button>
    <div v-if="open" class="body" v-html="html" />
  </section>
</template>
