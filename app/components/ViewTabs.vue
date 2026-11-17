<script setup lang="ts">
/** Вкладки (сохранённые наборы фильтров) + слот для кнопок справа. */
defineProps<{ counts: Record<string, number> }>();
const { views, activeId, add, rename, remove } = useViews();

function onAdd() {
  const name = prompt('Название вкладки (текущие фильтры будут скопированы):')?.trim();
  if (name) add(name);
}
function onRename(v: (typeof views.value)[number]) {
  const name = prompt('Новое название вкладки:', v.name)?.trim();
  if (name) rename(v, name);
}
function onRemove(v: (typeof views.value)[number]) {
  if (confirm(`Удалить вкладку «${v.name}»?`)) remove(v);
}
</script>

<template>
  <nav class="tabs">
    <button
      v-for="v in views"
      :key="v.id"
      class="tab"
      :class="{ on: v.id === activeId }"
      title="Двойной клик — переименовать"
      @click="activeId = v.id"
      @dblclick="onRename(v)"
    >
      {{ v.name }} <small>{{ counts[v.id] ?? 0 }}</small>
      <span v-if="!v.builtin" class="tab-del" title="Удалить вкладку" @click.stop="onRemove(v)">×</span>
    </button>
    <button class="ghost add" title="Новая вкладка из текущих фильтров" @click="onAdd">+</button>
    <span class="spacer" />
    <slot />
  </nav>
</template>
