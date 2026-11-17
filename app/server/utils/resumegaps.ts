/** Чего из required/nice_to_have вакансии нет в текущем резюме трека (scripts/lib/resumeskills.ts). */
import { resumeText, skillsInText } from '../../../scripts/lib/resumeskills.ts';
import { loadSkills, normSkill } from '../../../scripts/lib/skills.ts';

export function resumeGaps(rm: Record<string, any> | null | undefined): string[] | null {
  if (!rm?.resume) return null;
  const text = resumeText(rm.resume);
  if (!text) return null;
  // словарь и резюме читаем на каждый запрос: файлы маленькие, правка резюме видна сразу
  const dict = loadSkills();
  const have = skillsInText(text, dict);
  return [...(rm.required ?? []), ...(rm.nice_to_have ?? [])].filter((s: string) => !have.has(normSkill(String(s), dict).name));
}
