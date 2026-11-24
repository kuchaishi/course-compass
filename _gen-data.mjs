import { writeFileSync } from 'node:fs';
const base = 'file:///D:/qoder_mvp/src/data/';
const cg = await import(base + 'courseSkillGraph.ts');
const sa = await import(base + 'skillAliases.ts');
const bj = await import(base + 'benchmarkJobs.ts');
const pe = await import(base + 'personas.ts');
const pt = await import(base + 'policyTimelines2027.ts');
const data = {
  skills: cg.SKILL_NODES,
  aliases: sa.SKILL_ALIASES,
  courses: cg.COURSES,
  jobs: bj.BENCHMARK_JOBS,
  personas: pe.PERSONAS,
  timelines: pt.getTimelines(pt.BASE_GRADUATION_YEAR, '2026-11-19'),
  pathNames: { baoyan: '保研', kaoyan: '考研', abroad: '留学', job: '就业', civil_service: '考公·选调' },
  baseGraduationYear: pt.BASE_GRADUATION_YEAR,
};
console.log('counts', {
  skills: data.skills.length, aliases: Object.keys(data.aliases).length,
  courses: data.courses.length, jobs: data.jobs.length,
  personas: data.personas.length, timelines: data.timelines.length,
});
console.log('sampleSkill', JSON.stringify(data.skills[0]));
console.log('sampleCourse', JSON.stringify(data.courses[0]).slice(0, 400));
console.log('sampleJob', JSON.stringify(data.jobs[0]).slice(0, 500));
console.log('samplePersona', JSON.stringify(data.personas[0]).slice(0, 500));
writeFileSync('D:/course-compass-review/_cc-data.json', JSON.stringify(data));
console.log('written bytes', JSON.stringify(data).length);