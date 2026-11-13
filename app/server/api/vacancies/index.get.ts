/** List: front matter only. Filtering/sorting is done on the client (dozens–hundreds of rows). */
export default defineEventHandler(() => {
  const items = allVacancies()
    .map((v): Record<string, any> => ({ ...v.data, _file: relFile(v.file) }))
    .sort((a, b) => String(b.collected_at).localeCompare(String(a.collected_at)) || (b.scores?.overall ?? -1) - (a.scores?.overall ?? -1));
  return { items, errors: loadErrors() };
});
