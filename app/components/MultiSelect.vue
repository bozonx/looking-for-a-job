<script setup lang="ts">
interface OptionItem {
  value: string;
  label: string;
}

const props = withDefaults(
  defineProps<{
    modelValue: string[];
    options: readonly (string | OptionItem)[] | (string | OptionItem)[];
    title: string;
    placeholder?: string;
  }>(),
  {
    placeholder: 'все',
  },
);

const emit = defineEmits<{
  (e: 'update:modelValue', value: string[]): void;
}>();

const isOpen = ref(false);
const searchQuery = ref('');
const rootRef = ref<HTMLElement | null>(null);
const searchInputRef = ref<HTMLInputElement | null>(null);

const normalizedOptions = computed<OptionItem[]>(() => {
  return props.options.map((opt) =>
    typeof opt === 'string' ? { value: opt, label: opt } : opt,
  );
});

const filteredOptions = computed(() => {
  const q = searchQuery.value.trim().toLowerCase();
  if (!q) return normalizedOptions.value;
  return normalizedOptions.value.filter(
    (opt) =>
      opt.label.toLowerCase().includes(q) ||
      opt.value.toLowerCase().includes(q),
  );
});

const selectedLabels = computed(() => {
  const map = new Map(normalizedOptions.value.map((o) => [o.value, o.label]));
  return props.modelValue.map((val) => map.get(val) ?? val);
});

const displayLabel = computed(() => {
  if (!props.modelValue.length) {
    return `${props.title}: ${props.placeholder}`;
  }
  if (props.modelValue.length === 1) {
    return `${props.title}: ${selectedLabels.value[0]}`;
  }
  return `${props.title} (${props.modelValue.length})`;
});

const buttonTitle = computed(() => {
  if (!props.modelValue.length) {
    return `${props.title}: ${props.placeholder}`;
  }
  return `${props.title}: ${selectedLabels.value.join(', ')}`;
});

function toggleOpen() {
  isOpen.value = !isOpen.value;
  if (isOpen.value) {
    nextTick(() => searchInputRef.value?.focus());
  } else {
    searchQuery.value = '';
  }
}

function isSelected(val: string) {
  return props.modelValue.includes(val);
}

function toggleItem(val: string) {
  const current = [...props.modelValue];
  const idx = current.indexOf(val);
  if (idx >= 0) {
    current.splice(idx, 1);
  } else {
    current.push(val);
  }
  emit('update:modelValue', current);
}

function clear() {
  emit('update:modelValue', []);
}

function selectAllFiltered() {
  const currentSet = new Set(props.modelValue);
  for (const opt of filteredOptions.value) {
    currentSet.add(opt.value);
  }
  emit('update:modelValue', Array.from(currentSet));
}

function onDocPointerDown(e: PointerEvent) {
  if (isOpen.value && rootRef.value && !rootRef.value.contains(e.target as Node)) {
    isOpen.value = false;
    searchQuery.value = '';
  }
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && isOpen.value) {
    isOpen.value = false;
    searchQuery.value = '';
  }
}

onMounted(() => {
  document.addEventListener('pointerdown', onDocPointerDown);
  document.addEventListener('keydown', onKeydown);
});

onUnmounted(() => {
  document.removeEventListener('pointerdown', onDocPointerDown);
  document.removeEventListener('keydown', onKeydown);
});
</script>

<template>
  <div ref="rootRef" class="multiselect">
    <button
      type="button"
      class="ms-btn"
      :class="{ 'ms-btn-active': modelValue.length > 0, 'ms-btn-open': isOpen }"
      :title="buttonTitle"
      @click="toggleOpen"
    >
      <span class="ms-label">{{ displayLabel }}</span>
      <span
        v-if="modelValue.length"
        class="ms-clear"
        title="Сбросить выбор"
        @click.stop="clear"
      >×</span>
      <span class="ms-arrow" :class="{ open: isOpen }">▾</span>
    </button>

    <div v-if="isOpen" class="ms-dropdown" @click.stop>
      <div v-if="normalizedOptions.length > 6" class="ms-search-wrap">
        <input
          ref="searchInputRef"
          v-model="searchQuery"
          type="text"
          class="ms-search-input"
          placeholder="Поиск..."
          @keydown.esc="isOpen = false"
        />
        <button
          v-if="searchQuery"
          type="button"
          class="ms-search-clear"
          title="Очистить поиск"
          @click="searchQuery = ''"
        >×</button>
      </div>

      <div class="ms-list">
        <label
          v-for="opt in filteredOptions"
          :key="opt.value"
          class="ms-item"
          :class="{ selected: isSelected(opt.value) }"
        >
          <input
            type="checkbox"
            :checked="isSelected(opt.value)"
            @change="toggleItem(opt.value)"
          />
          <span class="ms-item-text" :title="opt.label">{{ opt.label }}</span>
        </label>
        <div v-if="!filteredOptions.length" class="ms-empty">Ничего не найдено</div>
      </div>

      <div v-if="modelValue.length > 0 || (searchQuery && filteredOptions.length)" class="ms-footer">
        <button
          v-if="searchQuery && filteredOptions.length"
          type="button"
          class="ms-footer-btn"
          @click="selectAllFiltered"
        >
          Выбрать найденные
        </button>
        <button
          v-if="modelValue.length > 0"
          type="button"
          class="ms-footer-btn"
          @click="clear"
        >
          Сбросить ({{ modelValue.length }})
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.multiselect {
  position: relative;
  display: inline-block;
}

.ms-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font: inherit;
  font-size: 13px;
  color: var(--fg);
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 6px;
  padding: 4px 8px;
  cursor: pointer;
  white-space: nowrap;
  user-select: none;
  transition: border-color 0.15s, background-color 0.15s;
}

.ms-btn:hover {
  border-color: var(--muted);
}

.ms-btn-active {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 10%, var(--panel));
  color: var(--fg);
  font-weight: 500;
}

.ms-btn-open {
  border-color: var(--accent);
}

.ms-label {
  display: inline-block;
  max-width: 170px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ms-clear {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  font-size: 13px;
  line-height: 1;
  color: var(--muted);
  cursor: pointer;
  margin-left: 2px;
}

.ms-clear:hover {
  background: color-mix(in srgb, var(--fg) 15%, transparent);
  color: var(--fg);
}

.ms-arrow {
  font-size: 10px;
  color: var(--muted);
  transition: transform 0.15s;
  line-height: 1;
}

.ms-arrow.open {
  transform: rotate(180deg);
}

.ms-dropdown {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  min-width: 190px;
  max-width: 290px;
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 6px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
  z-index: 1000;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.ms-search-wrap {
  position: relative;
  padding: 6px;
  border-bottom: 1px solid var(--line);
}

.ms-search-input {
  width: 100%;
  padding: 4px 22px 4px 6px;
  font-size: 12px;
  border: 1px solid var(--line);
  border-radius: 4px;
  background: var(--bg);
  color: var(--fg);
}

.ms-search-clear {
  position: absolute;
  right: 10px;
  top: 50%;
  transform: translateY(-50%);
  border: none;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
  font-size: 13px;
  padding: 0 4px;
}

.ms-list {
  max-height: 220px;
  overflow-y: auto;
  padding: 4px 0;
  display: flex;
  flex-direction: column;
}

.ms-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 10px;
  cursor: pointer;
  font-size: 13px;
  user-select: none;
  color: var(--fg);
}

.ms-item:hover {
  background: color-mix(in srgb, var(--cur) 60%, transparent);
}

.ms-item.selected {
  background: color-mix(in srgb, var(--accent) 8%, transparent);
}

.ms-item input[type="checkbox"] {
  cursor: pointer;
  margin: 0;
}

.ms-item-text {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ms-empty {
  padding: 12px;
  font-size: 12px;
  color: var(--muted);
  text-align: center;
}

.ms-footer {
  padding: 4px 8px;
  border-top: 1px solid var(--line);
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  background: color-mix(in srgb, var(--line) 20%, var(--panel));
}

.ms-footer-btn {
  font-size: 11px;
  padding: 2px 6px;
  background: transparent;
  border: none;
  color: var(--accent);
  cursor: pointer;
}

.ms-footer-btn:hover {
  text-decoration: underline;
}
</style>
