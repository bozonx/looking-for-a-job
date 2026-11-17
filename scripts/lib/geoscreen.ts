import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { CONFIG_DIR } from './env.ts';
/** Только явные структурные ограничения; адрес компании не является ограничением найма. */
export interface GeoInput {
  location?: string | null;
  allowedCountries?: string[] | null;
  workplace?: string | null;
  officeCountry?: string | null;
}
const aliases: Record<string, string> = { argentina: 'AR', 'united states': 'US', usa: 'US', 'united kingdom': 'GB', uk: 'GB', canada: 'CA', brazil: 'BR', germany: 'DE', france: 'FR', spain: 'ES', poland: 'PL', india: 'IN', australia: 'AU', mexico: 'MX', portugal: 'PT', netherlands: 'NL' };
const country = (value: string) => aliases[value.trim().toLowerCase()] ?? (/^[A-Z]{2}$/.test(value.trim()) ? value.trim() : null);
export function geoscreen(input: GeoInput) {
  const location = input.location?.trim() ?? '';
  const rules = YAML.parse(fs.readFileSync(path.join(CONFIG_DIR, 'prefilter.yaml'), 'utf8')).exclude_location_exact ?? [];
  if (rules.some((rule: string) => rule.toLowerCase() === location.toLowerCase()))
    return { hire_from_ar: 'no', hire_from_ar_evidence: 'Явное ограничение локации: ' + location, stop_flags: ['location_restricted'] };
  const countries = input.allowedCountries?.map(country) ?? [];
  if (countries.length && countries.every(Boolean)) {
    if (!countries.includes('AR')) return { hire_from_ar: 'no', hire_from_ar_evidence: 'Источник явно ограничивает страны найма: ' + input.allowedCountries!.join(', '), stop_flags: ['location_restricted'] };
    return { hire_from_ar: 'yes', hire_from_ar_evidence: 'Аргентина входит в явный список стран найма источника.', stop_flags: [] };
  }
  const office = input.officeCountry ? country(input.officeCountry) : null;
  if (/^(on-?site|hybrid)$/i.test(input.workplace ?? '') && office && office !== 'AR')
    return { hire_from_ar: 'no', hire_from_ar_evidence: 'Обязательный офис вне Аргентины: ' + input.officeCountry, stop_flags: ['office_outside_ar'] };
  return { hire_from_ar: 'unknown', hire_from_ar_evidence: null, stop_flags: [] };
}
