import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { employmentEngine, readEmploymentData } from './_employment-data.mjs';

export const labelFormat='course-compass-employment-labels-v1';

export function annotationCases(documents, engine) {
  const catalogHash=engine.snapshotHash(engine.DATA.jobs);
  const seen=new Set();
  return documents.flatMap(document=>{
    if(document.format!=='course-compass-employment-review-v1'||document.catalogHash!==catalogHash||
      document.matchVersion!==engine.MATCH_VERSION||document.taxonomyVersion!==engine.TAXONOMY_VERSION||
      !Number.isFinite(Date.parse(document.asOf))||!Array.isArray(document.cases)) throw new Error('Review snapshot or version differs.');
    return document.cases.map(entry=>{
      const caseId=String(entry.caseId||'').toLowerCase();
      if(!/^[a-f0-9]{32}$/.test(caseId)||seen.has(caseId)) throw new Error('Invalid or duplicate case ID: '+caseId);
      seen.add(caseId);
      if(!Array.isArray(entry.candidates)||!entry.candidates.length||entry.candidates.length>40)
        throw new Error('Expected 1–40 candidates for case '+caseId);
      const ids=entry.candidates.map(candidate=>candidate.jobId);
      if(new Set(ids).size!==ids.length) throw new Error('Duplicate candidate for case '+caseId);
      const p=entry.projection;
      if(!p||!Array.isArray(p.completedCourseIds)||!Array.isArray(p.evidences)||
        p.evidences.some(item=>!item||!Array.isArray(item.skillIds))) throw new Error('Missing or invalid de-identified profile.');
      const skillNames=ids=>[...new Set(ids||[])].filter(id=>engine.SKILL_BY_ID.has(id)).map(id=>engine.skillName(id));
      const courses=ids=>[...new Set(ids||[])].filter(id=>engine.COURSE_BY_ID.has(id)).map(id=>engine.courseName(id));
      const directions=engine.CAREER_DIRECTIONS.filter(d=>
        d.id===p.preferences?.primaryDirectionId||p.preferences?.secondaryDirectionIds?.includes(d.id)).map(d=>d.name);
      const candidates=ids.map(jobId=>{
        const job=engine.JOB_BY_ID.get(jobId);
        if(!job) throw new Error('Candidate missing in review snapshot: '+jobId);
        const {title,org,locations,jdText,postUrl}=job;
        const match=engine.forwardMatch(p,[{...job,kind:'job'}],new Date(document.asOf)).all[0];
        return {jobId,title,org,locations,jdText,postUrl,reason:match.tierReason};
      });
      return {caseId,asOf:document.asOf,profile:{
        major:({cs:'计算机',mat_mech:'机械与材料',econ:'经管',chinese:'语言与人文'})[p.major]||'未知',
        degree:engine.DEGREE_LABEL[p.degree]||'未知',graduationYear:Number.isInteger(p.graduationYear)?p.graduationYear:null,
        completedCourses:courses(p.completedCourseIds),inProgressCourses:courses(p.inProgressCourseIds),
        courseSkills:skillNames(p.completedCourseSkillIds),directions,
        evidence:p.evidences.map(item=>({
          type:item.type==='实习'?'实习':'成果',confirmed:engine.hasVerifiedEvidence(item),skills:skillNames(item.skillIds),
        })).filter(item=>item.skills.length),
      },candidates};
    });
  });
}

export function attachExpertLabels(documents, annotations, engine) {
  const expected=annotationCases(documents,engine);
  const allowed=new Map(expected.map(entry=>[entry.caseId,new Set(entry.candidates.map(candidate=>candidate.jobId))]));
  const labels=new Map();
  for(const batch of annotations){
    if(batch.format!==labelFormat||batch.catalogHash!==engine.snapshotHash(engine.DATA.jobs)||
      batch.matchVersion!==engine.MATCH_VERSION||batch.taxonomyVersion!==engine.TAXONOMY_VERSION||!Array.isArray(batch.cases))
      throw new Error('Expert annotations snapshot or version differs.');
    for(const entry of batch.cases){
      if(!allowed.has(entry.caseId)||!entry.labels||Array.isArray(entry.labels)||typeof entry.labels!=='object')
        throw new Error('Unexpected annotation case: '+entry.caseId);
      for(const [id,label] of Object.entries(entry.labels)){
        if(!allowed.get(entry.caseId).has(id)||!Number.isInteger(label?.grade)||label.grade<0||label.grade>3)
          throw new Error('Invalid annotation for candidate: '+id);
        const key=entry.caseId+'\n'+id;
        if(labels.has(key)) throw new Error('Duplicate expert grade for '+id+' in '+entry.caseId);
        if(label.explanationMatches!=null&&typeof label.explanationMatches!=='boolean')
          throw new Error('Invalid explanation annotation: '+id);
        labels.set(key,{grade:label.grade,explanationMatches:label.explanationMatches??null});
      }
    }
  }
  if(!labels.size) throw new Error('No expert grades were supplied.');
  return documents.flatMap(document=>document.cases.map(entry=>{
    const next={...entry.labels};
    for(const candidate of entry.candidates){
      const id=candidate.jobId;
      const grade=labels.get(entry.caseId.toLowerCase()+'\n'+id);
      if(!grade) continue;
        if(next[id]?.grade!=null) throw new Error('Candidate already graded: '+id);
      next[id]=grade;
    }
    return {...document,cases:[{...entry,labels:next}]};
  }));
}

function makeReviewer(documents, engine) {
  const data={format:labelFormat,catalogHash:engine.snapshotHash(engine.DATA.jobs),matchVersion:engine.MATCH_VERSION,
    taxonomyVersion:engine.TAXONOMY_VERSION,cases:annotationCases(documents,engine)};
  if(!data.cases.length) throw new Error('There are no review cases.');
  const html=readFileSync(new URL('./_employment-annotate.html',import.meta.url),'utf8');
  return html.replace('/*__REVIEW_DATA__*/',()=>JSON.stringify(data).replaceAll('<','\\u003c'));
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const [mode,catalog,output,...files]=process.argv.slice(2);
  const split=files.indexOf('--labels');
  if(!catalog||!output||!files.length||!['prepare','attach'].includes(mode)||
    (mode==='attach'&&(split<1||split===files.length-1))||(mode==='prepare'&&split!==-1))
    throw new Error('Usage: _employment-annotate.mjs prepare <catalog.json> <review.html> <samples...> | attach <catalog.json> <graded.ndjson> <samples...> --labels <annotations...>');
  const engine=employmentEngine(readEmploymentData(catalog));
  const read=name=>JSON.parse(readFileSync(name,'utf8'));
  const documents=(mode==='prepare'?files:files.slice(0,split)).map(read);
  const content=mode==='prepare'?makeReviewer(documents,engine)
    :attachExpertLabels(documents,files.slice(split+1).map(read),engine).map(document=>JSON.stringify(document)).join('\n')+'\n';
  writeFileSync(output,content,{flag:'wx'});
}
