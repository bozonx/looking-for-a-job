/** Без сети: проверяем только явную локацию, не адрес компании и не произвольный текст. */
import { loadAll, writeVacancy } from './lib/vacancy.ts';
import { geoscreen } from './lib/geoscreen.ts';
let changed = 0;
for (const v of loadAll()) {
  if (v.data.hire_from_ar && v.data.hire_from_ar !== 'unknown') continue;
  const geo = geoscreen({ location: v.data.location });
  if (geo.hire_from_ar === 'unknown') continue;
  writeVacancy(v.file, { ...v.data, ...geo, stop_flags: [...new Set([...(v.data.stop_flags ?? []), ...geo.stop_flags])] }, v.body);
  changed++;
}
console.log(`Геоскрининг: обновлено ${changed}`);
