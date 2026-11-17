import { resumeGaps } from '../../utils/resumegaps';

export default defineEventHandler((event) => {
  const v = findById(getRouterParam(event, 'id')!);
  if (!v) throw createError({ statusCode: 404, statusMessage: 'Vacancy not found' });
  // пробелы резюме — по текущему profile/resumes/<трек>.md, а не сохранённые при скоринге
  return { data: v.data, body: v.body, file: relFile(v.file), resume_missing: resumeGaps(v.data.resume_match) };
});
