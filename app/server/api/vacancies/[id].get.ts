export default defineEventHandler((event) => {
  const v = findById(getRouterParam(event, 'id')!);
  if (!v) throw createError({ statusCode: 404, statusMessage: 'Vacancy not found' });
  return { data: v.data, body: v.body, file: relFile(v.file) };
});
