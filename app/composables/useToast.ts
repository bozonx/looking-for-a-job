/** Одно всплывающее сообщение на всё приложение; длинные висят дольше. */
const toast = ref('');
let timer: ReturnType<typeof setTimeout> | undefined;

export function useToast() {
  function show(text: string) {
    toast.value = text;
    clearTimeout(timer);
    timer = setTimeout(() => (toast.value = ''), text.length > 80 ? 8000 : 3500);
  }
  return { toast: readonly(toast), show };
}

/** Текст ошибки $fetch / createError. */
export const errText = (e: any): string => e?.data?.message ?? e?.data?.statusMessage ?? e?.message ?? String(e);
