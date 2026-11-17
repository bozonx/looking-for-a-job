import { analyzeResumeMatch } from '../../utils/resumegaps';

export default defineEventHandler((event) => {
  const v = findById(getRouterParam(event, 'id')!);
  if (!v) throw createError({ statusCode: 404, statusMessage: 'Vacancy not found' });
  const analysis = analyzeResumeMatch(v.data.resume_match, allVacancies());
  // пробелы резюме — по текущему profile/resumes/<трек>.md, а не сохранённые при скоринге
  return {
    data: v.data,
    body: v.body,
    file: relFile(v.file),
    resume_missing: analysis?.missing ?? null,
    resume_analysis: analysis,
  };
});
