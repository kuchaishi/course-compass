import { createHash, randomUUID } from 'node:crypto';
import { closeSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { assertEmploymentCatalog, assertEmploymentShape } from './_employment-contract.mjs';

export const employmentDataFile = new URL('./_cc-data.json', import.meta.url);
const engineFile = new URL('./_cc-engine.js', import.meta.url);
const smartRecruitersCities = new Map(Object.entries({
  shanghai:'上海', yangpuqu:'上海', beijing:'北京', shenzhen:'深圳', guangzhou:'广州', suzhou:'苏州',
  wuxi:'无锡', hefei:'合肥', hangzhou:'杭州', nanjing:'南京', ningbo:'宁波', chengdu:'成都',
  chongqing:'重庆', changsha:'长沙', changchun:'长春', shenyang:'沈阳',
  xian:'西安', qingdao:'青岛', tianjin:'天津', wuhan:'武汉', taicang:'太仓', kunshan:'昆山',
}));

export function readEmploymentData(file = employmentDataFile) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

export function employmentEngine(data) {
  const window = { CC_DATA: data };
  runInNewContext(readFileSync(engineFile, 'utf8'), { window, URL }, { filename: '_cc-engine.js' });
  return window.CC;
}

export function validateEmploymentData(data) {
  assertEmploymentShape('Catalog', data);
  // The engine extends the legacy catalog dictionary with its current taxonomy.
  const engine = employmentEngine(data);
  if (data.employmentSchemaVersion !== engine.EMPLOYMENT_SCHEMA_VERSION)
    throw new Error('Employment catalog and engine schema versions differ');
  assertEmploymentCatalog(data, engine.SKILL_BY_ID);
  return engine;
}

export function normalizePosting(job, engine) {
  const sourceSnapshot=engine.sourceSnapshotOf(job);
  const rawCity=sourceSnapshot.via==='smartrecruiters' ? sourceSnapshot.rawCity : null;
  const location=rawCity ? smartRecruitersCities.get(rawCity.toLowerCase().replace(/ shi$/i,'').replace(/[^a-z]/g,'')) || rawCity : null;
  return {
    ...job,
    schemaVersion: engine.EMPLOYMENT_SCHEMA_VERSION,
    jobType: engine.jobTypeOf(job),
    jobFamilyId: engine.jobFamilyOf(job)?.id || null,
    jdHash: job.jdText ? createHash('sha256').update(job.jdText).digest('hex') : null,
    salary: engine.salaryParse(job.jdText),
    ...(location ? { locations:[location] } : {}),
    sourceSnapshot,
  };
}

export function jobLinkIdentity(value) {
  if (!URL.canParse(value)) return null;
  const url = new URL(value);
  if (url.protocol === 'https:' && url.hostname === 'jobs.smartrecruiters.com') {
    const match = /^\/([a-z0-9]+)\/(\d+)(?:[-/]|$)/i.exec(url.pathname);
    if (match) return 'smartrecruiters:' + match[1].toLowerCase() + '/' + match[2];
  }
  return value;
}

export function writeEmploymentFile(file, content) {
  const temporary = new URL(file.href + '.' + randomUUID() + '.tmp');
  const tempFile = openSync(temporary, 'wx');
  let pending = true;
  try {
    try {
      writeFileSync(tempFile, content);
    } finally {
      closeSync(tempFile);
    }
    renameSync(temporary, file);
    pending = false;
  } finally {
    if (pending) unlinkSync(temporary);
  }
}

export function updateEmploymentData(update, file = employmentDataFile) {
  const lockFile = new URL(file.href + '.lock');
  const lock = openSync(lockFile, 'wx');
  try {
    const data = readEmploymentData(file);
    const result = update(data);
    if (result == null) return result;
    validateEmploymentData(data);
    writeEmploymentFile(file,JSON.stringify(data));
    return result;
  } finally {
    closeSync(lock);
    unlinkSync(lockFile);
  }
}
