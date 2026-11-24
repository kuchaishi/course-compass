import { createHash } from 'node:crypto';
import { statSync } from 'node:fs';
import { employmentDataFile, readEmploymentData, validateEmploymentData } from './_employment-data.mjs';
import { assertEmploymentShape } from './_employment-contract.mjs';
import { researchEmploymentGrowth } from './_employment-growth.mjs';

export const catalogPath = '/employment/jobs';
const matchPath='/employment/matches/query';
const growthPath='/employment/roadmaps/research';
const jobTypes = ['intern','campus','social'];
const statuses = ['current','all','confirmed_active','observed_active','unknown','stale','expired','closed','archived'];
const queryKeys = new Set(['q','city','industry','company','companyType','degree','type','direction','family','status',
  'salaryMin','salaryMax','sort','limit','offset','snapshot']);
const clean = value => value?.trim() || '';
const timestamp = value => Date.parse(value||'');
const textMatch = (query,job,engine) => {
  const haystack=[job.title,job.org,job.category,job.industry,job.jdText,
    ...job.skills.map(skill=>engine.skillName(skill.skillId))].join(' ').toLowerCase();
  return query.every(term=>haystack.includes(term));
};

function postingSummary(job,freshness,engine) {
  const family=engine.jobFamilyOf(job);
  return {
    id:job.id,title:job.title,org:job.org,category:job.category,industry:job.industry??null,locations:job.locations,
    jobType:job.jobType,companyType:job.companyType??null,minDegree:job.hardGate.minDegree??null,
    internshipPeriod:job.internshipPeriod??null,benefits:job.benefits||[],salary:job.salary,
    postedAt:job.citation.publishDate??null,postUrl:job.postUrl,citation:job.citation,source:freshness,
    skills:job.skills.map(skill=>({id:skill.skillId,name:engine.skillName(skill.skillId)})),
    directionId:family?.directionId??null,familyId:family?.id??null,
  };
}

function listJobs(query,data,engine,now) {
  const get=key=>clean(query.get(key));
  const within=(key,defaultValue,max)=> {
    const raw=get(key);
    return raw===''?defaultValue:/^\d+$/.test(raw)&&Number(raw)<=max?Number(raw):NaN;
  };
  const q=get('q'),terms=q.toLowerCase().split(/\s+/).filter(Boolean);
  const limit=within('limit',24,100),offset=within('offset',0,1000000);
  const low=within('salaryMin',0,10000000),high=within('salaryMax',Infinity,10000000);
  const sort=get('sort')||'newest',status=get('status')||'current',type=get('type'),degree=get('degree');
  const directionId=get('direction'),familyId=get('family');
  const city=get('city'),industry=get('industry'),company=get('company'),companyType=get('companyType');
  const direction=engine.CAREER_DIRECTIONS.find(item=>item.id===directionId);
  const family=engine.CAREER_DIRECTIONS.flatMap(item=>item.families).find(item=>item.id===familyId);
  const repeated=new Set();
  for(const key of query.keys()){
    if(!queryKeys.has(key)||repeated.has(key)||get(key).length>160) throw new Error('INVALID_FILTER');
    repeated.add(key);
  }
  if(!Number.isInteger(limit)||limit<1||!Number.isInteger(offset)||!(low<=high)||!['newest','salary'].includes(sort)||
    !statuses.includes(status)||(type&&!jobTypes.includes(type))||(degree&&degree!=='unknown'&&!Object.hasOwn(engine.DEGREE_LABEL,degree))||
    (directionId&&!direction)||(familyId&&!family)||(direction&&family&&family.directionId!==direction.id)) throw new Error('INVALID_FILTER');

  const filtered=data.jobs.flatMap(job=>{
    if(type&&job.jobType!==type) return [];
    if(degree&&(job.hardGate.minDegree||'unknown')!==degree) return [];
    if(city&&!job.locations.includes(city)) return [];
    if(industry&&industry!==(job.industry||'unknown')) return [];
    if(company&&company!==job.org) return [];
    if(companyType&&companyType!==(job.companyType||'unknown')) return [];
    const role=engine.jobFamilyOf(job);
    if((directionId&&role?.directionId!==directionId)||(familyId&&role?.id!==familyId)) return [];
    const pay=engine.salaryMonthlyOf(job);
    if((get('salaryMin')||get('salaryMax'))&&(pay==null||pay<low||pay>high)) return [];
    const freshness=engine.jobFreshness(job,now);
    return textMatch(terms,job,engine)?[{job,freshness,pay}]:[];
  });
  const selected=engine.distinctPostings(filtered,now,row=>row.job).filter(({freshness})=>
    status==='current'?!freshness.ended:status==='all'||freshness.status===status);
  const newest=(a,b)=>(timestamp(b.job.citation.publishDate)||0)-(timestamp(a.job.citation.publishDate)||0)||
    a.job.id.localeCompare(b.job.id);
  selected.sort(sort==='salary'?(a,b)=>(b.pay??-1)-(a.pay??-1)||newest(a,b):newest);
  return {total:selected.length,limit,offset,items:selected.slice(offset,offset+limit)
    .map(({job,freshness})=>postingSummary(job,freshness,engine))};
}

function resolveMatchProfile(profile,engine,data) {
  const has=map=>value=>map.has(value);
  const knownCities=new Set(data.jobs.flatMap(job=>job.locations));
  const directions=new Set(engine.CAREER_DIRECTIONS.map(direction=>direction.id));
  const p=profile.preferences;
  if((profile.rank&&profile.rank.position>profile.rank.total)||
    ![...profile.completedCourseIds,...profile.inProgressCourseIds].every(has(engine.COURSE_BY_ID))||
    ![...profile.completedCourseSkillIds,...profile.inProgressCourseSkillIds,...profile.evidences.flatMap(item=>item.skillIds)]
      .every(has(engine.SKILL_BY_ID))||
    !p.cities.every(has(knownCities))||
    ![p.primaryDirectionId,...p.secondaryDirectionIds,...p.excludedDirectionIds].filter(Boolean).every(has(directions)))
    throw new Error('INVALID_MATCH_PROFILE');
  return {...profile,evidences:profile.evidences.map((item,index)=>({...item,id:'query_evidence_'+(index+1)}))};
}

export function createEmploymentCatalogHandler({ file=employmentDataFile, now=()=>new Date(), growthModel, growth=researchEmploymentGrowth }={}) {
  let cache;
  let researching=false;
  const load=()=>{
    const stats=statSync(file,{bigint:true});
    const key=[stats.ino,stats.mtimeNs,stats.ctimeNs,stats.size].join(':');
    if(cache?.key===key) return cache;
    const data=readEmploymentData(file);
    const engine=validateEmploymentData(data);
    const snapshot=createHash('sha256').update(JSON.stringify(data.jobs)).digest('hex');
    const headers={
      'X-Employment-Schema-Version':engine.EMPLOYMENT_SCHEMA_VERSION,
      'X-Match-Algorithm-Version':engine.MATCH_VERSION,
      'X-Taxonomy-Version':engine.TAXONOMY_VERSION,
      'X-Employment-Snapshot':snapshot,
    };
    cache={key,data,engine,snapshot,headers};
    return cache;
  };
  return async function respond(request,pathname,send,readLocalJson){
    if(pathname!==catalogPath&&!pathname.startsWith(catalogPath+'/')&&pathname!==matchPath&&pathname!==growthPath) return false;
    if(pathname===growthPath){
      if(request.method!=='POST'){
        request.resume(); send(405,{error:'POST_REQUIRED'},{Allow:'POST'}); return true;
      }
      const input=await readLocalJson();
      if(!input.ok){ send(input.status,{error:input.error}); return true; }
      let value;
      try {
        value=input.value;
        assertEmploymentShape('GrowthResearchQuery',value);
        if(request.url!==growthPath||!value.profile.personalized) throw new Error('INVALID_QUERY');
      }catch{ send(400,{error:'INVALID_GROWTH_QUERY'}); return true; }
      let catalog;
      try{ catalog=load(); }catch{ send(503,{error:'CATALOG_UNAVAILABLE'}); return true; }
      const {data,engine,snapshot,headers}=catalog;
      if(value.snapshot!==snapshot){ send(409,{error:'SNAPSHOT_CHANGED',snapshot},headers); return true; }
      const targets=value.jobIds.map(id=>engine.REQ_BY_ID.get(id));
      if(targets.some(job=>job?.kind!=='job'||!engine.JOB_BY_ID.has(job.id))){ send(404,{error:'JOB_NOT_FOUND'},headers); return true; }
      let profile;
      try{
        profile=resolveMatchProfile(value.profile,engine,data);
        profile.weeklyHours=value.weeklyHours;
        if(value.focus&&!engine.SKILL_BY_ID.has(value.focus)) throw new Error('UNKNOWN_FOCUS');
      }catch{ send(400,{error:'INVALID_GROWTH_QUERY'},headers); return true; }
      if(researching){ send(503,{error:'GROWTH_BUSY'},headers); return true; }
      researching=true;
      try{
        const plan=await growth({targets,profile,engine,at:now(),focus:value.focus,model:growthModel});
        send(200,{snapshot,...plan},headers);
      }catch{ send(503,{error:'GROWTH_UNAVAILABLE'},headers); }
      finally{ researching=false; }
      return true;
    }
    if(pathname===matchPath){
      if(request.method!=='POST'){
        request.resume();
        send(405,{error:'POST_REQUIRED'},{Allow:'POST'});
        return true;
      }
      const input=await readLocalJson();
      if(!input.ok){ send(input.status,{error:input.error}); return true; }
      let value;
      try {
        value=input.value;
        assertEmploymentShape('MatchQuery',value);
        if(request.url!==matchPath) throw new Error('INVALID_FILTER');
      }catch{ send(400,{error:'INVALID_MATCH_QUERY'}); return true; }
      let catalog;
      try { catalog=load(); }
      catch { send(503,{error:'CATALOG_UNAVAILABLE'}); return true; }
      const {data,engine,snapshot,headers}=catalog;
      if(value.snapshot!==snapshot){
        send(409,{error:'SNAPSHOT_CHANGED',snapshot},headers);
        return true;
      }
      try {
        const profile=resolveMatchProfile(value.profile,engine,data);
        const at=now();
        const postings=value.jobIds?value.jobIds.map(id=>engine.REQ_BY_ID.get(id)):
          engine.distinctPostings(engine.allRequirements().filter(job=>job.kind==='job'),at).filter(job=>!engine.jobFreshness(job,at).ended);
        if(postings.some(job=>!job||job.kind!=='job'||!engine.JOB_BY_ID.has(job.id))){
          send(404,{error:'JOB_NOT_FOUND'},headers);
          return true;
        }
        const ranked=engine.forwardMatch(profile,postings,at).all;
        const items=ranked.slice(0,value.limit??24).map(({req,...match})=>({...match,
          req:{id:req.id,kind:req.kind,title:req.title,org:req.org,skills:req.skills}}));
        send(200,{snapshot,asOf:at.toISOString(),total:ranked.length,items},headers);
      }catch(error){
        const invalid=error.message==='INVALID_MATCH_PROFILE';
        send(invalid?400:500,{error:invalid?'INVALID_MATCH_QUERY':'MATCH_UNAVAILABLE'},headers);
      }
      return true;
    }
    if(!['GET','HEAD'].includes(request.method)){
      request.resume();
      send(405,{error:'GET_REQUIRED'},{Allow:'GET, HEAD'});
      return true;
    }
    let catalog;
    try { catalog=load(); }
    catch { send(503,{error:'CATALOG_UNAVAILABLE'}); return true; }
    const {data,engine,snapshot,headers}=catalog;
    const query=new URLSearchParams(request.url.slice(pathname.length+1));
    const requestedSnapshot=query.get('snapshot');
    if(query.getAll('snapshot').length>1||(requestedSnapshot!=null&&!/^[0-9a-f]{64}$/.test(requestedSnapshot))){
      send(400,{error:'INVALID_FILTER'},headers);
      return true;
    }
    if(requestedSnapshot&&requestedSnapshot!==snapshot){
      send(409,{error:'SNAPSHOT_CHANGED',snapshot},headers);
      return true;
    }
    const observedAt=now();
    const envelope={snapshot,asOf:observedAt.toISOString()};
    if(pathname===catalogPath){
      try { send(200,{...envelope,...listJobs(query,data,engine,observedAt)},headers); }
      catch(error) {
        const invalid=error.message==='INVALID_FILTER';
        send(invalid?400:500,{error:invalid?'INVALID_FILTER':'CATALOG_UNAVAILABLE'},headers);
      }
    }else{
      let id;
      try { id=decodeURIComponent(pathname.slice(catalogPath.length+1)); }
      catch { send(400,{error:'INVALID_JOB_ID'},headers); return true; }
      const job=engine.JOB_BY_ID.get(id);
      if([...query.keys()].some(key=>key!=='snapshot')) send(400,{error:'INVALID_FILTER'},headers);
      else if(!job) send(404,{error:'JOB_NOT_FOUND'},headers);
      else send(200,{...envelope,job:{...postingSummary(job,engine.jobFreshness(job,observedAt),engine),
        hardGate:job.hardGate,jdText:job.jdText,requirements:engine.jobRequirementsOf(job),facts:engine.jobFactsOf(job),
        companyIntro:job.companyIntro??null}},headers);
    }
    return true;
  };
}
