<script setup lang="ts">
/** «Куда откликаться»: каналы отклика, основной (совпадает с apply_method) — первым; копирование значения. */
type Channel = { type: string; value: string; by?: string; note?: string | null };
const props = defineProps<{ id: string; channels: Channel[] | null | undefined; applyMethod: string | null | undefined }>();

const main = computed(() => channelKind(props.applyMethod));
const list = computed(() => [...(props.channels ?? [])].sort((a, b) => Number(b.type === main.value) - Number(a.type === main.value)));

const copied = ref('');
async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    copied.value = text;
    setTimeout(() => copied.value === text && (copied.value = ''), 1500);
  } catch {}
}
</script>

<template>
  <section>
    <h3>Куда откликаться</h3>
    <p v-if="!list.length" class="muted">
      {{ CHANNEL_LABEL.unknown!.icon }} канал неизвестен — нужен real_url, email или другой контакт (<code>npm run resolve-urls -- {{ id }}</code>)
    </p>
    <ul v-else class="channels">
      <li v-for="(c, i) in list" :key="c.type + c.value" :class="{ main: i === 0 && c.type === main }">
        <span :title="CHANNEL_LABEL[c.type]?.label">{{ CHANNEL_LABEL[c.type]?.icon ?? '•' }}</span>
        <b>{{ CHANNEL_LABEL[c.type]?.label ?? c.type }}</b>:
        <a v-if="channelHref(c)" :href="channelHref(c)!" target="_blank" rel="noopener">{{ c.value }}</a>
        <template v-else>{{ c.value }}</template>
        <button class="copy" type="button" :title="'Скопировать ' + c.value" @click="copy(c.value)">{{ copied === c.value ? '✓' : '⧉' }}</button>
        <span v-if="c.note" class="muted"> — {{ c.note }}</span>
        <span v-if="c.by" class="muted small"> · {{ c.by }}</span>
      </li>
    </ul>
  </section>
</template>
