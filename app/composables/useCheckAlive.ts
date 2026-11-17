/** Фоновая проверка живости (`npm run check-alive`, server/utils/checkAlive.ts): запуск и опрос состояния. */
interface AliveState {
  running: boolean;
  summary: string;
  last: string;
  exitCode: number | null;
}

export function useCheckAlive(onDone: () => unknown) {
  const { show } = useToast();
  const state = ref<AliveState | null>(null);
  let timer: ReturnType<typeof setInterval> | undefined;
  const stop = () => {
    clearInterval(timer);
    timer = undefined;
  };

  async function poll() {
    try {
      const s = await $fetch<AliveState>('/api/check-alive');
      const wasRunning = state.value?.running;
      state.value = s;
      if (s.running && !timer) timer = setInterval(poll, 2000);
      if (!s.running) stop();
      if (wasRunning && !s.running) {
        const line = s.summary.split('\n').find((l) => l.includes('проверено:')) ?? s.summary;
        show(s.exitCode === 0 ? `Проверка живости: ${line.replace(/^- /, '')}` : `Ошибка проверки: ${s.summary}`);
        await onDone();
      }
    } catch {}
  }

  /** force — перепроверить и проверенные сегодня. */
  async function start(force: boolean) {
    try {
      state.value = await $fetch<AliveState>('/api/check-alive', { method: 'POST', body: { force } });
      if (!timer) timer = setInterval(poll, 2000);
    } catch (e) {
      show(`Не удалось запустить проверку: ${errText(e)}`);
    }
  }

  onMounted(poll);
  onUnmounted(stop);
  return { state, start };
}
