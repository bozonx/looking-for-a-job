/** Запустить `npm run check-alive` в фоне. body: { force?: boolean } — перепроверить и проверенные сегодня. */
export default defineEventHandler(async (event) => {
  const body = (await readBody(event).catch(() => null)) ?? {};
  if (!startCheckAlive(!!body.force)) throw createError({ statusCode: 409, statusMessage: 'Проверка уже идёт' });
  return checkAliveState();
});
