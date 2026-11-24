import { readEmploymentData, employmentEngine, normalizePosting, updateEmploymentData } from './_employment-data.mjs';

const real = readEmploymentData(new URL('./real-jobs.json', import.meta.url));
const matchable = real.filter(job => job.skills?.length && job.jdText && /^tx_(?:\d+|proj_[a-z0-9]+)$/.test(job.id));
if (!matchable.length) throw new Error('No valid Tencent jobs to merge; keeping the current snapshot');

const summary = updateEmploymentData(data => {
  const engine = employmentEngine(data);
  const jobs = new Map(data.jobs.filter(job=>job.isBenchmarkModel!==true).map(job => [job.id, job]));
  for (const job of matchable) {
    const previous = jobs.get(job.id);
    const updated = normalizePosting(job, engine);
    if (previous?.jdHash === updated.jdHash && previous.modelRequirements)
      updated.modelRequirements = previous.modelRequirements;
    jobs.set(job.id, updated);
  }
  data.employmentSchemaVersion = engine.EMPLOYMENT_SCHEMA_VERSION;
  data.jobs = [...jobs.values()];

  for (const persona of data.personas) {
    if (persona.targetJobIds?.length && persona.targetJobIds.every(id => jobs.has(id))) continue;
    const candidates = matchable.filter(job => job.majors?.includes(persona.major));
    const byCategory = new Map();
    for (const job of candidates) if (!byCategory.has(job.category)) byCategory.set(job.category,job.id);
    const picks = [...new Set([...byCategory.values(), ...candidates.map(job => job.id)])].slice(0,3);
    if (picks.length) persona.targetJobIds = picks;
  }
  return { fetched: real.length, matched: matchable.length, merged: jobs.size };
});
console.log('Tencent employment snapshot:', summary);
