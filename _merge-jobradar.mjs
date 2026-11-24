import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readEmploymentData, employmentEngine, jobLinkIdentity, normalizePosting, updateEmploymentData } from './_employment-data.mjs';

const time=value=>Date.parse(value||'');
const identity=source=>JSON.stringify([source.sourceId,source.sourceJobId]);

export function mergeJobRadar(data, input) {
  const {jobs:incoming,observations,snapshotAt}=Array.isArray(input)?{jobs:input,observations:[]}:input||{};
  if(!Array.isArray(incoming)||!Array.isArray(observations)||(!Array.isArray(input)&&
    (input.format!=='course-compass-jobradar-v1'||!Number.isFinite(time(snapshotAt))))) throw new Error('Invalid JobRadar merge input');
  const engine = employmentEngine(data);
  const jobs = new Map(data.jobs.map(job => [job.id, job]));
  const urls = new Set(data.jobs.map(job => jobLinkIdentity(job.postUrl)));
  let added = 0;
  let refreshed = 0;
  let closed = 0;
  let reopened = 0;
  let statusUpdated = 0;

  for (const job of incoming) {
    if (!job.id || !job.jdText || !job.postUrl || job.sourceSnapshot?.via !== 'jobradar') throw new Error('Invalid JobRadar record');
    const previous = jobs.get(job.id);
    if (previous?.sourceSnapshot?.via === 'jobradar') {
      if(identity(previous.sourceSnapshot)!==identity(job.sourceSnapshot)) throw new Error('JobRadar identity changed: '+job.id);
      if(time(job.sourceSnapshot.snapshotAt)<time(previous.sourceSnapshot.snapshotAt)||
        time(job.sourceSnapshot.lastSeenAt)<time(previous.sourceSnapshot.lastSeenAt)) continue;
      if(previous.sourceSnapshot.closedAt&&time(job.sourceSnapshot.lastSeenAt)<=time(previous.sourceSnapshot.closedAt)) continue;
      const annotation = previous.modelRequirements;
      const unchanged=previous.jdHash===job.jdHash;
      const revision=(previous.sourceSnapshot.revision||1)+(unchanged?0:1);
      const next={...job,sourceSnapshot:{...job.sourceSnapshot,
        firstSeenAt:previous.sourceSnapshot.firstSeenAt||job.sourceSnapshot.firstSeenAt,revision},
        ...(unchanged&&annotation?{modelRequirements:annotation}:{})};
      if(previous.sourceSnapshot.status==='closed'&&job.sourceSnapshot.status!=='closed') reopened++;
      jobs.set(job.id,next);
      refreshed++;
    } else if (!jobs.has(job.id) && !urls.has(jobLinkIdentity(job.postUrl))) {
      jobs.set(job.id, job);
      urls.add(jobLinkIdentity(job.postUrl));
      added++;
    }
  }

  const byIdentity=new Map([...jobs.values()].filter(job=>job.sourceSnapshot?.via==='jobradar')
    .map(job=>[identity(job.sourceSnapshot),job]));
  const observed=new Set();
  for(const observation of observations){
    if(!observation?.sourceId||!observation.sourceJobId||!Number.isFinite(time(observation.lastSeenAt))||
      !Object.hasOwn(observation,'closedAt')||!Object.hasOwn(observation,'applyEndAt')||!Object.hasOwn(observation,'sourceLastOkAt')||
      time(observation.lastSeenAt)>time(snapshotAt)||
      (observation.closedAt!=null&&(!Number.isFinite(time(observation.closedAt))||time(observation.closedAt)>time(snapshotAt))))
      throw new Error('Invalid JobRadar status observation');
    const key=identity(observation);
    if(observed.has(key)) throw new Error('Duplicate JobRadar observation: '+key);
    observed.add(key);
    const job=byIdentity.get(key);
    if(!job) continue;
    const previous=job.sourceSnapshot;
    if(time(snapshotAt)<time(previous.snapshotAt)||time(observation.lastSeenAt)<time(previous.lastSeenAt)||
      (previous.closedAt&&observation.closedAt&&time(observation.closedAt)<time(previous.closedAt))||
      (!observation.closedAt&&previous.closedAt&&time(observation.lastSeenAt)<=time(previous.closedAt))) continue;
    const {closedAt,lastSeenAt,sourceLastOkAt,applyEndAt}=observation;
    const status=closedAt?'closed':'observed_active';
    const next={...previous,snapshotAt,lastSeenAt,sourceLastOkAt,applyEndAt,status};
    if(closedAt) next.closedAt=closedAt;
    else delete next.closedAt;
    if(JSON.stringify(next)===JSON.stringify(previous)) continue;
    if(status==='closed'&&previous.status!=='closed') closed++;
    if(status!=='closed'&&previous.status==='closed') reopened++;
    statusUpdated++;
    jobs.set(job.id,{...job,sourceSnapshot:next});
  }
  data.employmentSchemaVersion = engine.EMPLOYMENT_SCHEMA_VERSION;
  data.jobs = [...jobs.values()].map(job => normalizePosting(job,engine));
  return { added, refreshed, closed, reopened, statusUpdated, records: jobs.size, companies: new Set(data.jobs.map(job => job.org)).size,
    salaryDisclosed: data.jobs.filter(job => job.salary).length };
}

if (process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  const input = process.argv.includes('--normalize-existing') ? [] : readEmploymentData(new URL('./jobradar-jobs.json',import.meta.url));
  console.log('Employment snapshot:',updateEmploymentData(data=>mergeJobRadar(data,input)));
}
