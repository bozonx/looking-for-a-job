/** Горячие клавиши без модификаторов; в полях ввода не срабатывают. */
export function useHotkeys(map: () => Record<string, () => unknown>) {
  function onKey(e: KeyboardEvent) {
    const t = e.target as HTMLElement;
    if (e.ctrlKey || e.metaKey || e.altKey || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) || t.isContentEditable) return;
    const fn = map()[e.key];
    if (fn) {
      e.preventDefault();
      fn();
    }
  }
  onMounted(() => window.addEventListener('keydown', onKey));
  onUnmounted(() => window.removeEventListener('keydown', onKey));
}
