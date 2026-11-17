/** Анализ пробелов резюме и фактов (profile/resumes/<track>.md и profile/facts.md) относительно resume_match. */
import fs from 'node:fs';
import path from 'node:path';
import { CONFIG_DIR, ROOT } from '../../../scripts/lib/env.ts';
import { hasSpelling, resumeText, skillsInText } from '../../../scripts/lib/resumeskills.ts';
import { loadSkills, normSkill } from '../../../scripts/lib/skills.ts';

export interface ResumeAnalysis {
  missing: string[];
  inFacts: string[];
  responsibilitiesMatched: string[];
  responsibilitiesMissing: string[];
  softMatched: string[];
  spellingDiffs: Record<string, string[]>;
  frequencies: Record<string, number>;
}

function factsText(): string | null {
  const f = path.join(ROOT, 'profile', 'facts.md');
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null;
}

export function resumeGaps(rm: Record<string, any> | null | undefined): string[] | null {
  return analyzeResumeMatch(rm)?.missing ?? null;
}

export function analyzeResumeMatch(
  rm: Record<string, any> | null | undefined,
  vacancies: Array<{ data: Record<string, any> }> = [],
  overrides?: { resume?: string; facts?: string | null },
): ResumeAnalysis | null {
  if (!rm?.resume) return null;
  const text = overrides?.resume ?? resumeText(rm.resume);
  if (!text) return null;

  const dict = loadSkills();
  const respDict = loadSkills(path.join(CONFIG_DIR, 'responsibilities.yaml'));
  const have = skillsInText(text, dict);
  const haveResp = skillsInText(text, respDict);

  const facts = overrides && 'facts' in overrides ? (overrides.facts ?? null) : factsText();
  const factsSkills = facts ? skillsInText(facts, dict) : new Set<string>();
  const factsResp = facts ? skillsInText(facts, respDict) : new Set<string>();

  const reqAndNice = [...(rm.required ?? []), ...(rm.nice_to_have ?? [])].map(String);
  const missing = reqAndNice.filter((s) => !have.has(normSkill(s, dict).name));

  const responsibilitiesMatched: string[] = [];
  const responsibilitiesMissing: string[] = [];
  for (const r of (rm.responsibilities ?? []).map(String)) {
    const canon = normSkill(r, respDict).name;
    if (haveResp.has(canon) || hasSpelling(text, r)) responsibilitiesMatched.push(r);
    else responsibilitiesMissing.push(r);
  }

  const inFacts = new Set<string>();
  if (facts) {
    for (const s of missing) {
      if (factsSkills.has(normSkill(s, dict).name) || hasSpelling(facts, s)) inFacts.add(s);
    }
    for (const s of (rm.ats_keywords_missing ?? []).map(String)) {
      if (factsSkills.has(normSkill(s, dict).name) || hasSpelling(facts, s)) inFacts.add(s);
    }
    for (const r of responsibilitiesMissing) {
      if (factsResp.has(normSkill(r, respDict).name) || hasSpelling(facts, r)) inFacts.add(r);
    }
  }

  const softMatched = (rm.soft_requirements ?? [])
    .map(String)
    .filter((s: string) => hasSpelling(text, s));

  const spellingDiffs: Record<string, string[]> = {};
  const ks = rm.keyword_spellings as Record<string, string[]> | undefined;
  if (ks) {
    const missingSet = new Set(missing);
    for (const [skill, spellings] of Object.entries(ks)) {
      if (missingSet.has(skill)) continue;
      const missingSpellings = (spellings ?? []).filter((sp) => !hasSpelling(text, sp));
      if (missingSpellings.length) spellingDiffs[skill] = missingSpellings;
    }
  }

  const frequencies: Record<string, number> = {};
  if (vacancies.length) {
    const skillCounts = new Map<string, number>();
    const respCounts = new Map<string, number>();
    for (const v of vacancies) {
      const vrm = v.data?.resume_match;
      if (!vrm) continue;
      const seenSkill = new Set<string>();
      for (const s of [...(vrm.required ?? []), ...(vrm.nice_to_have ?? [])]) {
        const c = normSkill(String(s), dict).name;
        if (!seenSkill.has(c)) {
          seenSkill.add(c);
          skillCounts.set(c, (skillCounts.get(c) ?? 0) + 1);
        }
      }
      const seenResp = new Set<string>();
      for (const r of vrm.responsibilities ?? []) {
        const c = normSkill(String(r), respDict).name;
        if (!seenResp.has(c)) {
          seenResp.add(c);
          respCounts.set(c, (respCounts.get(c) ?? 0) + 1);
        }
      }
    }
    for (const s of [...reqAndNice, ...(rm.ats_keywords_missing ?? []).map(String)]) {
      const n = skillCounts.get(normSkill(s, dict).name);
      if (n) frequencies[s] = n;
    }
    for (const r of (rm.responsibilities ?? []).map(String)) {
      const n = respCounts.get(normSkill(r, respDict).name);
      if (n) frequencies[r] = n;
    }
  }

  return {
    missing,
    inFacts: [...inFacts],
    responsibilitiesMatched,
    responsibilitiesMissing,
    softMatched,
    spellingDiffs,
    frequencies,
  };
}
