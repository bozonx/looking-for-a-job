/** Транслитерация кириллицы в латиницу (для ключей дедупликации и имён файлов). */
const MAP: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm',
  н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch',
  ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya', і: 'i', ї: 'yi', є: 'e', ґ: 'g', ў: 'u',
};

export function translit(s: string): string {
  return s
    .toLowerCase()
    .replace(/[а-яёіїєґў]/g, (c) => MAP[c] ?? c)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '');
}
