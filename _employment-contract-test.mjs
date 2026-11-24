import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmdirSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { assertEmploymentShape } from './_employment-contract.mjs';
import { employmentEngine, readEmploymentData, updateEmploymentData, validateEmploymentData, writeEmploymentFile } from './_employment-data.mjs';
import { applySourceObservations, observeCompany } from './_fetch-official-jobs.mjs';

const data = readEmploymentData();
validateEmploymentData(data);
for (const lead of data.employmentLeads?.items||[]) {
  if (!lead.relatedSourceId) continue;
  const postings=data.jobs.filter(job=>job.sourceSnapshot.sourceId===lead.relatedSourceId);
  assert.ok(postings.some(job=>job.jobType==='intern'&&job.sourceSnapshot.linkScope==='job_detail'&&job.jdText.trim()));
}
const CC = employmentEngine(data);
const officialSource={id:'src_bosch_public',board:'BoschGroup',org:'博世',careers:'https://www.bosch.com/careers/',fallbackIndustry:'工业技术'};
const existingOfficial=data.jobs.filter(job=>job.sourceSnapshot.sourceId===officialSource.id&&job.sourceSnapshot.via==='smartrecruiters').slice(0,2);
assert.equal(existingOfficial.length,2);
const [closing,unreachable]=existingOfficial;
const newOfficialId='999999999999996';
const observedDetail=(id,active)=>({id,name:'Intern - source-check fixture',active,company:{identifier:officialSource.board},
  location:{country:'CN',city:'Shanghai'},postingUrl:'https://jobs.smartrecruiters.com/BoschGroup/'+id+'-fixture',
  jobAd:{sections:{jobDescription:{text:'<p>Familiar with Python and SQL.</p>'}}}});
const sourceResult=await observeCompany(officialSource,1,async link=>{
  const id=new URL(link).pathname.split('/').at(-1);
  if(id==='postings') return {content:[{id:newOfficialId,name:'Intern - source-check fixture',location:{country:'CN'}}]};
  if(id===unreachable.sourceSnapshot.sourceJobId) throw new Error('HTTP_404');
  if(id===closing.sourceSnapshot.sourceJobId) return {...observedDetail(id,false),postingUrl:closing.postUrl};
  return observedDetail(id,undefined);
},CC,existingOfficial);
assert.equal(sourceResult.recheckedCount,1);
assert.equal(sourceResult.discoveredCount,1);
assert.equal(sourceResult.lastError,'HTTP_404');
const observedCatalog=structuredClone(data);
const [sourceSummary]=applySourceObservations(observedCatalog,[sourceResult],CC);
assert.equal(sourceSummary.status,'partial');
assert.equal(observedCatalog.jobs.find(job=>job.id===closing.id).sourceSnapshot.status,'closed');
assert.deepEqual(observedCatalog.jobs.find(job=>job.id===unreachable.id),unreachable);
assert.equal(observedCatalog.jobs.find(job=>job.sourceSnapshot.sourceJobId===newOfficialId).sourceSnapshot.status,'observed_active');
validateEmploymentData(observedCatalog);
const absentFromList=await observeCompany(officialSource,1,async link=>new URL(link).pathname.endsWith('/postings')
  ?{content:[]}:{...observedDetail(closing.sourceSnapshot.sourceJobId,undefined),postingUrl:closing.postUrl},CC,[closing]);
assert.equal(absentFromList.jobs[0].sourceSnapshot.status,closing.sourceSnapshot.status==='closed'?'closed':'unknown');
const discoveryFailed=await observeCompany(officialSource,1,async link=>{
  if(new URL(link).pathname.endsWith('/postings')) throw new Error('HTTP_503');
  return {...observedDetail(closing.sourceSnapshot.sourceJobId,true),postingUrl:closing.postUrl};
},CC,[closing]);
assert.equal(discoveryFailed.discoveryError,'HTTP_503');
assert.equal(discoveryFailed.recheckedCount,1);
assert.equal(discoveryFailed.jobs[0].sourceSnapshot.status,'confirmed_active');
let restrictedCalls=0;
const restricted=await observeCompany(officialSource,1,async()=>{ restrictedCalls++; throw new Error('HTTP_429'); },CC,existingOfficial);
assert.equal(restrictedCalls,1);
assert.equal(restricted.error,'HTTP_429');
const eventList=data.employmentCompetitions;
assert.equal(eventList.length,91);
assert.ok(eventList.every((item,index)=>item.number===index+1));
assert.equal(eventList[82].notes,'高职赛（含本科赛道）');
assert.equal(eventList[90].submittedGrade,null);
assert.equal(eventList[22].links[0].url,'https://www.siemenscup-cimc.org.cn/competition/index');
assert.equal(eventList[46].submittedGrade,'B');
assert.ok(eventList[46].links.some(link=>link.url==='https://www.ccpitcsc.org/mcdt/4855'));
for(const direction of CC.CAREER_DIRECTIONS) assert.ok(direction.skillIds.every(id=>CC.SKILL_BY_ID.has(id)),direction.id);
for(const job of data.jobs) assert.equal(job.jobFamilyId,CC.jobFamilyOf(job)?.id??null,job.id);
for(const [id,family] of [
  ['jr_1jjue1m','circuits'],['jr_u4kcds','circuits'],['jr_1295dik','hardware-testing'],
  ['sr_boschgroup_744000123861275','automation-control'],['jr_1gbba4p','battery-development'],
  ['tx_1283126460798018560','systems-development'],['tx_1282707395466077184','ai-applications'],
  ['jr_qzhq8i','finance-investment'],['jr_1y4obg','people-operations'],['jr_1271l0g','education-training'],
]) assert.equal(CC.jobFamilyOf(CC.JOB_BY_ID.get(id)).id,family,id);
assert.equal(CC.jobFamilyOf({title:'通用管理培训生'}),null);
const when = new Date('2026-11-19T12:00:00Z');
const requirements = CC.allRequirements();
const mirrors=['jr_1l85zdf','jr_1fyrogs'].map(id=>CC.REQ_BY_ID.get(id));
assert.notEqual(mirrors[0].postUrl,mirrors[1].postUrl);
assert.equal(CC.postingIdentity(mirrors[0]),CC.postingIdentity(mirrors[1]));
assert.equal(CC.distinctPostings(mirrors,when).length,1);
const closedMirror={...mirrors[0],sourceSnapshot:{...mirrors[0].sourceSnapshot,status:'closed',closedAt:'2026-11-19T11:00:00Z'}};
assert.equal(CC.distinctPostings([mirrors[1],closedMirror],when)[0],closedMirror);
assert.equal(CC.distinctPostings([mirrors[0],{...mirrors[1],locations:['深圳']}],when).length,2);
assert.equal(CC.distinctPostings([mirrors[0],{...mirrors[1],jdHash:'f'.repeat(64)}],when).length,2);
const campusProjects=data.jobs.filter(job=>job.postUrl==='https://join.qq.com'&&job.sourceSnapshot.linkScope!=='job_detail');
assert.ok(campusProjects.length>=2);
assert.equal(CC.distinctPostings(campusProjects,when).length,campusProjects.length);
const states = [
  { profile: {} },
  { profile: { major: '未知专业', gpa: 0 }, jobs: { personalized: false } },
  ...data.personas.map(persona => ({
    profile: {
      major: ({ cs: '计算机', mat_mech: '机械电子', econ: '经济学', chinese: '中文' })[persona.major],
      degree: 'bachelor', graduationDate: persona.graduationYear + '-06',
      rank: persona.rank?.position, rankTotal: persona.rank?.total, gpa: persona.gpaPercent,
      completedCourseIds: persona.completedCourseIds, evidences: persona.evidences, weeklyHours: persona.weeklyHours,
    },
  })),
];
const imported = CC.makeImportedJob({ jdText: '岗位：后端工程师\n熟悉 Java 和 SQL。' }, CC.ccProfileFromState(states[0]));
const importedWithLink = CC.makeImportedJob({ jdText: '岗位：固件工程师\n熟悉 STM32。', sourceUrl: 'https://example.com/' }, CC.ccProfileFromState(states[0]));
const practiceProfile=CC.ccProfileFromState(states[0]);
const canJob=CC.makeImportedJob({jdText:'岗位：固件实习生\n熟悉 CAN 总线。'},practiceProfile);
CC.setImportedJobs([canJob]);
const canGaps=CC.computeGaps(practiceProfile,[canJob.id]);
const canGap=canGaps.find(item=>item.skillId==='industrial_bus');
assert.deepEqual(Array.from(canGap.hoursRange),[5,9]);
const scheduled=hours=>CC.roadmapTasksOf(canGaps,{}, {...practiceProfile,weeklyHours:hours}).find(item=>item.skillId==='industrial_bus');
assert.equal(scheduled(3).schedule.twoWeekFit,'possible');
assert.equal(scheduled(2).schedule.twoWeekFit,'over');
assert.equal(scheduled(6).schedule.twoWeekFit,'fits');
assert.ok(scheduled(6).missingPrerequisites.includes(CC.skillName('embedded_c')));
assert.equal(CC.simulateGapImpact(practiceProfile,canGap,when).newlyScored,1);
assert.equal(practiceProfile.evidences.length,0);
CC.setImportedJobs([]);
const profileCount = states.length;
let matchCount = 0;
let skillCount = 0;
let factCount = 0;
for (const state of states) {
  const profile = CC.ccProfileFromState(state);
  assertEmploymentShape('EmploymentProfile', profile);
  const candidates = [...requirements, imported, importedWithLink];
  const ranked = CC.forwardMatch(profile, candidates, when).all;
  assert.equal(ranked.length, candidates.length);
  for (const result of ranked) {
    assertEmploymentShape('MatchResult', result, result.req.id);
    assert.equal(result.matchVersion, CC.MATCH_VERSION);
    assert.equal(result.missingCount, result.missingSkillIds.length);
    assert.deepEqual(result.eligibility.failed, result.eligibility.checks.filter(check => check.status === 'FAIL'));
    assert.deepEqual(result.eligibility.pending, result.eligibility.checks.filter(check => check.status === 'UNKNOWN'));
    assert.equal(result.eligibility.status, result.eligibility.failed.length ? 'FAIL' : result.eligibility.pending.length ? 'UNKNOWN' : 'PASS');
    assert.ok(result.evidenceRefs.every(id => profile.evidences.some(evidence => evidence.id === id)));
    if (profile.personalized === false) assert.equal(result.matchScore, null);
    matchCount++;
  }
}
for (const job of [...requirements, imported, importedWithLink]) {
  for (const fact of Object.values(CC.jobFactsOf(job)).flat()) {
    assertEmploymentShape('JdFact',fact,job.id);
    assert.equal(job.jdText.slice(...fact.sourceOffset),fact.sourceSpan);
    factCount++;
  }
  for (const requirement of CC.jobRequirementsOf(job)) {
    assertEmploymentShape('JobRequirement', requirement, requirement.id);
    assert.ok(CC.SKILL_BY_ID.has(requirement.skillId));
    assert.equal(job.jdText.slice(...requirement.sourceOffset), requirement.textSpan);
    skillCount++;
  }
}
const termsFixture={jobType:'intern',jdText:'实习周期至少3个月，每周可出勤4个工作日。\n提供住宿，食堂餐补300元/月。\n实习津贴另计。\n暂无法提供转正机会。\n负责员工入职、转正、调动。\n实习经历不少于6个月。'};
const termFacts=CC.jobTermsOf(termsFixture);
const spansOf=key=>Array.from(termFacts[key],fact=>fact.sourceSpan);
assert.deepEqual(spansOf('internshipSchedule'),['实习周期至少3个月，每周可出勤4个工作日']);
assert.deepEqual(spansOf('mealsAndHousing'),['提供住宿，食堂餐补300元/月']);
assert.deepEqual(spansOf('subsidies'),['实习津贴另计']);
assert.deepEqual(spansOf('conversion'),['暂无法提供转正机会']);
const fixtureFacts=CC.jobFactsOf(termsFixture);
for(const [key,facts] of Object.entries(termFacts)) assert.deepEqual(fixtureFacts[key],facts);

// Pin representative output in this match version to catch score and tier drift.
const regressionProfile = CC.ccProfileFromState({ profile: {
  major: '计算机', degree: 'bachelor', graduationDate: '2027-06', gpa: 80,
  evidences: [{ id: 'ev_fixture', title: '课程项目', description: 'Java 实现', type: '项目',
    skillIds: ['java'], verificationStatus: 'user_confirmed' }],
} });
const regressionJob = {
  id: 'fixture-regression', kind: 'job', title: '后端开发工程师', org: '示例企业', jobType: 'campus',
  majors: ['cs'], skills: [{ skillId: 'java', weight: 0.8 }, { skillId: 'sql_rdbms', weight: 0.2 }],
  jdText: '熟悉 Java 和 SQL。', hardGate: { minDegree: 'bachelor', graduationYears: [2027] },
  sourceSnapshot: { sourceId: 'fixture', status: 'confirmed_active', linkScope: 'job_detail',
    snapshotAt: when.toISOString(), lastSeenAt: when.toISOString() },
  citation: { trustTier: 'A_OFFICIAL' },
};
const cases = [
  [regressionProfile, regressionJob, ['worth', 'PASS', 57, 0.95, 'confirmed_active']],
  [{ ...regressionProfile, degree: 'associate' }, regressionJob, ['challenge', 'FAIL', 57, 0.95, 'confirmed_active']],
  [{ ...regressionProfile, graduationYear: null }, regressionJob, ['worth', 'UNKNOWN', 57, 0.9, 'confirmed_active']],
  [{ ...regressionProfile, evidences: [] }, regressionJob, ['challenge', 'PASS', null, 0.85, 'confirmed_active']],
  [regressionProfile, { ...regressionJob, sourceSnapshot: { ...regressionJob.sourceSnapshot, applyEndAt: '2026-11-18' } },
    ['challenge', 'PASS', 57, 0.8, 'expired']],
];
assert.equal(CC.skillStatusMap({ ...regressionProfile, evidences: [{ id: 'ev_cw', title: 'Java 课设', type: '课设', skillIds: ['java'], verificationStatus: 'user_confirmed' }] }).get('java'), 'learned_unverified');
assert.equal(CC.skillStatusMap(regressionProfile).get('java'), 'evidenced');
const adviceStages=['apply','blocked','verify_eligibility','prepare','historical'];
for (const [index,[profile, job, expected]] of cases.entries()) {
  const result = CC.forwardMatch(profile, [job], when).all[0];
  assert.deepEqual([result.tier, result.eligibility.status, result.matchScore, result.confidence, result.freshness.status],
    expected, 'Recommendation scores and tier behavior have drifted');
  const plan=CC.jobApplicationPlan(result,profile);
  assert.equal(plan.stage,adviceStages[index]);
  if(index===2) assert.deepEqual(Array.from(plan.profileFields),['graduation']);
}
const adviceProfile={...regressionProfile,evidences:[...regressionProfile.evidences,
  {id:'ev_irrelevant',title:'无关成果',description:'无关',skillIds:['mcu'],verificationStatus:'user_confirmed'},
  {id:'ev_rejected',title:'已撤回素材',description:'不要引用',skillIds:['java'],verificationStatus:'rejected'},
]};
const adviceMatch=CC.forwardMatch(adviceProfile,[regressionJob],when).all[0];
const advice=CC.jobApplicationPlan(adviceMatch,adviceProfile);
assert.deepEqual(Array.from(advice.materials,item=>item.evidenceId),['ev_fixture']);
assert.equal(advice.materials[0].requirement.textSpan,'熟悉 Java 和 SQL');
const unknownSource={...adviceMatch,freshness:{...adviceMatch.freshness,status:'stale'}};
assert.equal(CC.jobApplicationPlan(unknownSource,adviceProfile).stage,'verify_source');
assert.equal(CC.jobApplicationPlan(adviceMatch,{...adviceProfile,personalized:false}),null);

const first = data.jobs[0];
const mutatedCatalog = posting => ({ ...data, jobs: [posting] });
assert.throws(() => validateEmploymentData(mutatedCatalog({ ...first, postUrl: 'data:text/html,test' })), /postUrl/);
assert.throws(() => validateEmploymentData(mutatedCatalog({
  ...first, sourceSnapshot: { ...first.sourceSnapshot, lastSeenAt: null },
})), /active observation requires lastSeenAt/);
assert.throws(() => validateEmploymentData(mutatedCatalog({ ...first, jdText: first.jdText + ' changed' })), /jdHash does not match/);
assert.throws(() => validateEmploymentData({ ...data, jobs: [first, first] }), /duplicate job id/);
assert.throws(() => assertEmploymentShape('EmploymentProfile', { ...CC.ccProfileFromState(states[0]), gpaPercent: '0' }), /gpaPercent/);
const exampleRequirement = CC.jobRequirementsOf(imported)[0];
assert.throws(() => assertEmploymentShape('JobRequirement', { ...exampleRequirement, hardGate: true }), /hardGate/);
assert.throws(() => assertEmploymentShape('JobRequirement', { ...exampleRequirement, parser: 'local_model' }), /confidence/);
for (const familyId of ['firmware','backend','software-quality','mechanical-design']) {
  const pack = CC.buildDomainPack(familyId, requirements, when);
  assert.equal(pack.familyId,familyId);
  if (pack.sampleSize<3) assert.ok(pack.skills.every(skill=>skill.category!=='required'));
  for (const skill of pack.skills) {
    assert.ok(skill.mentions<=pack.sampleSize);
    for (const example of skill.examples) {
      const req = CC.REQ_BY_ID.get(example.jobId);
      assert.equal(req.postUrl,example.url);
      assert.ok(req.jdText.includes(example.sourceSpan));
    }
  }
}
const paid = data.jobs.find(job => job.salary);
assert.ok(paid, 'Catalog should include explicitly disclosed pay');
assert.throws(() => validateEmploymentData(mutatedCatalog({ ...paid, salary: { ...paid.salary, sourceSpan: 'inferred compensation' } })),
  /salary is missing its JD evidence/);

const directory = mkdtempSync(join(tmpdir(), 'cc-employment-contract-'));
const catalog = pathToFileURL(join(directory, 'catalog.json'));
try {
  const original = JSON.stringify(data);
  writeEmploymentFile(catalog, original);
  assert.throws(() => updateEmploymentData(snapshot => {
    snapshot.jobs[0].jdHash = null;
    return true;
  }, catalog), /jdHash does not match/);
  assert.equal(readFileSync(catalog, 'utf8'), original, 'Invalid updates must not replace the previous catalog');
  assert.equal(updateEmploymentData(() => true, catalog), true, 'Validation failure must release the update lock');
} finally {
  unlinkSync(catalog);
  rmdirSync(directory);
}
console.log(`Employment contract passed for ${data.jobs.length} public postings, ${profileCount} profiles, ${matchCount} match results, ${skillCount} grounded requirements, and ${factCount} JD facts`);
