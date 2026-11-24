import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { employmentEngine, jobLinkIdentity, normalizePosting, readEmploymentData, updateEmploymentData } from './_employment-data.mjs';

const api = 'https://api.smartrecruiters.com/v1/companies/';
const officialHost = 'jobs.smartrecruiters.com';
const provider = 'smartrecruiters';
const sources = [
  { id: 'src_bosch_public', board: 'BoschGroup', org: '博世', careers: 'https://www.bosch.com/careers/', fallbackIndustry: '工业技术' },
  { id: 'src_continental_public', board: 'Continental', org: 'Continental', careers: 'https://www.continental.com/en/career/', fallbackIndustry: '汽车与出行' },
];

function textOf(html) {
  const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ensp: ' ', emsp: ' ',
    mdash: '—', ndash: '–', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', bull: '•' };
  return String(html || '')
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<br\b[^>]*\/?>|<\/(?:p|div|h[1-6]|li|ul|ol|tr)\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (original, entity) => {
      if (!entity.startsWith('#')) return entities[entity.toLowerCase()] ?? original;
      const point = entity[1].toLowerCase() === 'x' ? Number.parseInt(entity.slice(2), 16) : Number(entity.slice(1));
      return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff) ? String.fromCodePoint(point) : original;
    })
    .split(/\r?\n/).map(line => line.trim()).filter(Boolean).join('\n');
}

export function entryJobType(record) {
  if (['intern','internship'].includes(record.typeOfEmployment?.id) || record.experienceLevel?.id === 'internship'
    || /实习|\binterns?\b|\binternship\b|\bworking student\b/i.test(record.name || '')) return 'intern';
  if (/校招|应届|\bgraduate (?:program(?:me)?|trainee|scheme)\b|\bnew grad(?:uate)?\b|\bmanagement trainee\b/i.test(record.name || '')) return 'campus';
  if (/\bplant trainee\b|\bjmp[_ -]+trainee\b/i.test(record.name || '')) return 'social';
  return null;
}

function trustedPostingLink(value, board, id) {
  if (!URL.canParse(value)) return false;
  const url = new URL(value);
  const [tenant, posting] = url.pathname.split('/').filter(Boolean);
  return url.protocol === 'https:' && url.hostname === officialHost && !url.username && !url.password &&
    tenant?.toLowerCase() === board.toLowerCase() && (posting === id || posting?.startsWith(id + '-'));
}

const timestamp = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;

export function smartRecruitersPosting(source, row, detail, observedAt, engine, listed = true) {
  const id = String(row.id ?? '');
  const title = typeof detail.name === 'string' ? detail.name.trim() : '';
  const jobType = entryJobType(detail) || entryJobType(row) || row.jobType;
  const postUrl = detail.postingUrl;
  if (!/^\d+$/.test(id) || String(detail.id) !== id || !title || !['intern','campus','social'].includes(jobType)
    || detail.company?.identifier?.toLowerCase() !== source.board.toLowerCase()
    || detail.location?.country?.toLowerCase() !== 'cn'
    || !trustedPostingLink(postUrl, source.board, id)) throw new Error('OFFICIAL_DETAIL_MISMATCH');

  const sections = detail.jobAd?.sections;
  const companyIntro = textOf(sections?.companyDescription?.text);
  const description = textOf(sections?.jobDescription?.text);
  const qualifications = textOf(sections?.qualifications?.text);
  const additional = textOf(sections?.additionalInformation?.text);
  const jdText = [description, qualifications && '【任职要求】\n' + qualifications,
    additional && '【补充信息】\n' + additional].filter(Boolean).join('\n\n');
  if (!description && !qualifications) throw new Error('OFFICIAL_JD_EMPTY');
  const p = { major: null, completedCourseIds: [], evidences: [], weeklyHours: 8 };
  const skills = engine.parseJdCore(p, jdText).skills.map(({ skillId, weight }) => ({ skillId, weight }));
  const label = { intern:'实习', campus:'校招', social:'社招' }[jobType];
  const city = typeof detail.location.city === 'string' ? detail.location.city.trim() : '';
  const previous=row.previousSource;
  const status=detail.active===true?'confirmed_active':detail.active===false?'closed':listed?'observed_active'
    :previous?.status==='closed'?'closed':'unknown';
  return normalizePosting({
    id: 'sr_' + source.board.toLowerCase() + '_' + id,
    title,
    org: source.org,
    orgLabel: detail.company.name || source.org,
    companyType: '外企',
    companyIntro: companyIntro || null,
    industry: detail.industry?.label || source.fallbackIndustry,
    category: detail.function?.label || '其他',
    jobType,
    recruitmentType: label,
    experience: { intern:'在校实习', campus:'应届', social:'社招' }[jobType],
    degree: null,
    locations: city ? [city] : [],
    remote: typeof detail.location.remote === 'boolean' ? detail.location.remote : null,
    majors: [],
    hardGate: {},
    skills,
    jdText,
    postUrl,
    isBenchmarkModel: false,
    snapshotDate: observedAt.slice(0, 10),
    citation: {
      sourceName: source.org + '官方招聘（SmartRecruiters）',
      sourceUrl: postUrl,
      publishDate: timestamp(detail.releasedDate) || timestamp(row.releasedDate),
      verifiedDate: observedAt.slice(0, 10),
      trustTier: 'A_OFFICIAL',
    },
    sourceSnapshot: {
      sourceId: source.id, sourceJobId: id, via: provider, linkScope: 'job_detail',
      firstSeenAt: observedAt, lastSeenAt: observedAt, sourceLastOkAt: observedAt,
      textObservedAt: observedAt, snapshotAt: observedAt, applyEndAt: previous?.applyEndAt??null,
      status, ...(status==='closed'?{closedAt:previous?.closedAt||observedAt}:{}),
      sourceEmploymentType: detail.typeOfEmployment?.label || null,
      rawCity: city || null,
      ...(trustedPostingLink(detail.applyUrl,source.board,id)?{applyUrl:detail.applyUrl}:{}),
    },
  }, engine);
}

const errorCode = error => error.message?.match(/^(?:OFFICIAL_[A-Z_]+|HTTP_\d{3})$/)?.[0] || 'FETCH_FAILED';

function publicClient() {
  let next = 0;
  return async function get(url) {
    for (let attempt = 0; attempt < 2; attempt++) {
      await delay(Math.max(0, next - Date.now()));
      next = Date.now() + 2000;
      try {
        const response = await fetch(url, { headers: { Accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(10000) });
        if (!response.ok) throw new Error('HTTP_' + response.status);
        return await response.json();
      } catch (error) {
        // Stop on access restrictions and client errors. A transient network error can be retried once.
        if (attempt || /^HTTP_4/.test(errorCode(error))) throw error;
      }
    }
  };
}

const isAccessRestriction = error => /^(HTTP_401|HTTP_403|HTTP_429)$/.test(error);

export async function observeCompany(source, limit, get, engine, previousJobs = []) {
  const attemptedAt = new Date().toISOString();
  const endpoint = api + source.board + '/postings';
  const tracked = new Map(previousJobs.filter(job=>job.sourceSnapshot?.via===provider&&job.sourceSnapshot.sourceId===source.id&&
    /^\d+$/.test(job.sourceSnapshot.sourceJobId||'')).map(job=>[job.sourceSnapshot.sourceJobId,job]));
  const candidates = new Map();
  let discoveryError=null,accessError=null;
  for (const query of ['实习', 'intern', 'graduate', 'trainee']) {
    const search = new URL(endpoint);
    search.search = new URLSearchParams({ country: 'cn', destination: 'PUBLIC', q: query, limit: '35' });
    try {
      const result = await get(search);
      if (!Array.isArray(result?.content)) throw new Error('OFFICIAL_LIST_SCHEMA');
      for (const row of result.content) {
        const id=String(row.id);
        if ((entryJobType(row)||tracked.has(id)) && /^\d+$/.test(id) && row.location?.country?.toLowerCase() === 'cn')
          candidates.set(id, row);
      }
    } catch (error) {
      discoveryError=errorCode(error);
      if(isAccessRestriction(discoveryError)) accessError=discoveryError;
      break;
    }
  }
  const discovered=[...candidates.values()].filter(row=>!tracked.has(String(row.id)));
  const group = type => discovered.filter(row => entryJobType(row) === type)
    .sort((a,b) => (b.releasedDate || '').localeCompare(a.releasedDate || '') || String(a.id).localeCompare(String(b.id)));
  const ranked = [...group('campus').slice(0, Math.ceil(limit / 4)), ...group('intern'), ...group('campus'), ...group('social')];
  const newIds=[...new Set(ranked.map(row=>String(row.id)))].slice(0,limit);
  const selected=[...tracked.keys(),...newIds];
  const jobs = [];
  let detailErrors = 0;
  let lastDetailError = null;
  let recheckedCount=0;
  for (const id of selected) {
    if(accessError) break;
    const prior=tracked.get(id),listed=candidates.get(id);
    const row={...listed,id,jobType:prior?.jobType,previousSource:prior?.sourceSnapshot};
    try {
      const detail = await get(endpoint + '/' + id);
      jobs.push(smartRecruitersPosting(source,row,detail,new Date().toISOString(),engine,Boolean(listed)));
      if(prior) recheckedCount++;
    } catch (error) {
      lastDetailError = errorCode(error);
      if (isAccessRestriction(lastDetailError)) accessError=lastDetailError;
      detailErrors++;
    }
  }
  const lastError=accessError||lastDetailError||discoveryError;
  return {source,attemptedAt,jobs,detailErrors,discoveryError,lastError,accessError,trackedCount:tracked.size,recheckedCount,
    discoveredCount:jobs.length-recheckedCount,error:!jobs.length&&lastError?lastError:null};
}

export function applySourceObservations(data, results, engine) {
  const jobs = new Map(data.jobs.map(job => [job.id, job]));
  const byPosting = new Map(data.jobs.flatMap(job => {
    const key = jobLinkIdentity(job.postUrl);
    return key ? [[key, job.id]] : [];
  }));
  const health = { ...data.employmentSources };
  const summary = [];
  for (const result of results) {
    const { source, attemptedAt, error } = result;
    const old = health[source.id] || {};
    if (Date.parse(attemptedAt)<Date.parse(old.lastAttemptAt)) continue;
    const sourceHealth = {
      ...old, name: source.org + '官方招聘', careersUrl: source.careers, lastAttemptAt: attemptedAt,
      status: error ? 'failed' : result.detailErrors||result.discoveryError ? 'partial' : 'ok',
      lastError: error || result.lastError || null,
      trackedCount:result.trackedCount, recheckedCount:result.recheckedCount, discoveredCount:result.discoveredCount,
    };
    if (!error) {
      sourceHealth.lastSuccessAt = result.jobs.reduce((latest,job)=>{
        const observed=job.sourceSnapshot.lastSeenAt;
        return Date.parse(observed)>Date.parse(latest)?observed:latest;
      },attemptedAt);
      sourceHealth.observedCount = result.jobs.length;
      for (const job of result.jobs) {
        const key = jobLinkIdentity(job.postUrl);
        const id = byPosting.get(key) || job.id;
        const previous = jobs.get(id);
        if (previous?.sourceSnapshot?.via===provider && Date.parse(job.sourceSnapshot.snapshotAt)<Date.parse(previous.sourceSnapshot.snapshotAt)) continue;
        const unchanged = previous?.jdHash === job.jdHash;
        const firstSeenAt = previous?.sourceSnapshot?.firstSeenAt || previous?.sourceSnapshot?.lastSeenAt || attemptedAt;
        const revision = (previous?.sourceSnapshot?.revision || 1) + (previous?.jdHash && !unchanged ? 1 : 0);
        const updated = {
          ...job, id,
          sourceSnapshot: { ...job.sourceSnapshot, firstSeenAt, revision,
            ...(job.sourceSnapshot.status==='closed'&&previous?.sourceSnapshot?.status==='closed'&&previous.sourceSnapshot.closedAt
              ? {closedAt:previous.sourceSnapshot.closedAt}:{}),
          },
          ...(unchanged && previous.modelRequirements ? { modelRequirements: previous.modelRequirements } : {}),
        };
        jobs.set(id, updated);
        byPosting.set(key,id);
      }
    }
    health[source.id] = sourceHealth;
    summary.push({ company: source.org, ...sourceHealth });
  }
  data.employmentSchemaVersion = engine.EMPLOYMENT_SCHEMA_VERSION;
  data.employmentSources = health;
  data.jobs = [...jobs.values()];
  return summary;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const limit = args.includes('--limit') ? Number(args[args.indexOf('--limit') + 1]) : 8;
  if (!Number.isInteger(limit) || limit < 1 || limit > 20) throw new Error('--limit must be from 1 to 20 per employer');
  const requested = args.includes('--source') ? args[args.indexOf('--source') + 1] : null;
  if (args.includes('--source')&&!requested) throw new Error('--source needs an employer name');
  const selected = requested ? sources.filter(source => source.board.toLowerCase() === requested.toLowerCase()) : sources;
  if (!selected.length) throw new Error('Unknown employer. Use BoschGroup or Continental.');
  const catalog=readEmploymentData();
  const engine = employmentEngine(catalog);
  const get = publicClient();
  const results = [];
  for (const source of selected) {
    const result=await observeCompany(source,limit,get,engine,catalog.jobs);
    results.push(result);
    if(result.accessError) break;
  }
  const update = data => applySourceObservations(data, results, engine);
  const summary = args.includes('--apply') ? updateEmploymentData(update) : update(readEmploymentData());
  console.log(JSON.stringify({ applied: args.includes('--apply'), sources: summary }, null, 2));
  if (results.every(x => x.error)) process.exitCode = 1;
}
