/* _fetch-jobradar.mjs — dev-time 从 JobRadar 合规 SQLite 快照抽取真实校招/实习岗位样本。
 * 数据源：github.com/lijiaqi-AI-Product-Manager/job_radar releases/data-latest（MIT 代码；只访问公开可读内容，不绕过登录/验证码）。
 * 合规：保留原始 url / publish_at / data_as_of；薪资·福利·实习周期仅取 JD 明示（确定性正则），未写=null，绝不臆造。
 * 行业来自 calendar.db target.sector（真实来源映射）；专业对口为 category→majors 启发式（非岗位事实）。
 * 运行：node _fetch-jobradar.mjs  → jobradar-jobs.json（随后 _merge-jobradar.mjs 合并 + _build-inline.mjs 内联） */
import { createReadStream, createWriteStream, existsSync, readFileSync } from 'node:fs';
import { mkdtemp, rmdir, unlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { createGunzip } from 'node:zlib';
import { writeEmploymentFile } from './_employment-data.mjs';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const RES = join(ROOT, '_research');

/* 载入引擎复用确定性抽取（与 _fetch-jobs.mjs 同法） */
const data = JSON.parse(readFileSync(ROOT + '/_cc-data.json', 'utf8'));
global.window = {};
window.CC_DATA = data;
eval(readFileSync(ROOT + '/_cc-engine.js', 'utf8'));
const CC = window.CC;
const NEUTRAL_P = { major: 'chinese', graduationYear: 2028, gpaPercent: 0, rank: null, completedCourseIds: [], evidences: [], weeklyHours: 8 };
const sectorMap = JSON.parse(readFileSync(RES + '/company-sector.json', 'utf8'));

/* category→适合专业（确定性启发式，用于专业对口标记，非岗位事实） */
const CAT_MAJORS = {
  '技术': ['cs', 'mat_mech'], '产品': ['cs', 'econ'], '运营': ['econ', 'chinese'], '设计': ['chinese', 'cs'],
  '金融': ['econ'], '职能': ['econ', 'chinese'], '市场销售': ['econ', 'chinese'], '工程制造': ['mat_mech', 'cs'],
  '医药': ['mat_mech', 'chinese'], '教育培训': ['chinese'], '管培': ['econ', 'chinese', 'cs', 'mat_mech'],
  '科研': ['cs', 'mat_mech'], '项目管理': ['cs', 'econ'], '门店零售': ['econ', 'chinese'], '酒店物业': ['econ', 'chinese'], '地产物业': ['econ', 'mat_mech'],
};
const DEGREE_GATE = { '大专': 'associate', '本科': 'bachelor', '硕士': 'master', '博士': 'phd' };
const tierOf = (sid) => String(sid).startsWith('jysd-') ? 'B_EXPERIENCE' : 'A_OFFICIAL';
function industryOf(company) { const s = sectorMap[company]; if (!s) return null; if (s.startsWith('省域·') || s.startsWith('扩展池')) return '区域综合'; return s; }
function companyTypeOf(sector) {
  if (!sector) return null;
  if (sector === '外资在华') return '外企';
  if (sector === '央企与国企') return '国企/央企';
  if (['银行', '证券基金与资管', '保险'].includes(sector)) return '金融机构';
  if (sector === '教育') return '教育/事业单位';
  return null;
}
function benefitsOf(t) {
  const out = [];
  const rules = [
    ['住宿/住房补贴', /提供(?:员工)?住宿|提供住房补贴|包住/],
    ['餐补', /(?:提供|发放|享有|享受)(?:餐补|餐饮补贴|饭补)|包吃/],
    ['实习/岗位补贴', /(?:提供|发放|享有|享受)(?:实习补贴|岗位补贴|实习津贴)/],
    ['转正/留用机会', /(?:提供|有机会|有望|可申请|可获得)(?:实习)?(?:转正|留用)|转正机会|留用机会/],
    ['五险一金', /(?:缴纳|提供|享有|享受)五险一金/],
  ];
  const clauses = t.split(/[\n。；;]/).filter(line => !/不提供|无补贴|不享受|不发放|不缴纳|无法|没有|无转正|无留用/.test(line));
  for (const [label, pattern] of rules) if (clauses.some(line => pattern.test(line))) out.push(label);
  return out;
}
function internPeriodOf(t) {
  const pats = [
    /实习(?:期|时长|周期|时间)[限为不少于]*\s*[:：]?\s*([0-9一二三四五六七八九十]+\s*个月[^，。;；\n]{0,10})/,
    /(每周[^\n，。;；]{0,6}?[0-9一二三四五六七八九十]+\s*天[^，。;；\n]{0,8})/,
    /([0-9]+\s*个月(?:以上|及以上)[^，。;；\n]{0,6}实习)/,
    /(实习\s*[0-9]+\s*个月[^，。;；\n]{0,6})/,
    /([0-9]+\s*个月以上)/,
  ];
  for (const re of pats) { const m = t.match(re); if (m) return m[1].trim(); }
  return null;
}

const jobsDb = new DatabaseSync(RES + '/jobs.db', { readOnly: true });
const snapshotAt = jobsDb.prepare("SELECT max(ts) AS ts FROM source_run WHERE status='ok'").get().ts;
if (!snapshotAt) throw new Error('JobRadar snapshot is missing successful observation times');
const snapshotDate = snapshotAt.slice(0, 10);
const sourceSeen = new Map(jobsDb.prepare("SELECT source_id, max(ts) AS ts FROM source_run WHERE status='ok' GROUP BY source_id").all()
  .map(row => [row.source_id, row.ts]));
const jdPath = process.env.CC_JD_SNAPSHOT || (existsSync(join(RES, 'jd_text.db')) ? join(RES, 'jd_text.db') : join(RES, 'jd_text.db.gz'));
const tmp = jdPath.endsWith('.gz') ? await mkdtemp(join(tmpdir(), 'course-compass-jobradar-')) : null;
let jdDb;
try {
  const input = tmp ? join(tmp, 'jd_text.db') : jdPath;
  if (tmp) await pipeline(createReadStream(jdPath), createGunzip(), createWriteStream(input, { flags: 'wx' }));
  jdDb = new DatabaseSync(input, { readOnly: true });

/*  introspect jd_text schema  */
const jdTabs = jdDb.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
let jdTable = null, jdKey = null, jdDesc = null, jdReq = null, jdObs = null;
for (const t of jdTabs) {
  const cols = jdDb.prepare('PRAGMA table_info("' + t + '")').all().map((c) => c.name);
  if (cols.includes('description') || cols.includes('requirements')) {
    jdTable = t;
    jdKey = cols.includes('job_id') ? 'job_id' : (cols.includes('id') ? 'id' : cols[0]);
    jdDesc = cols.includes('description') ? 'description' : null;
    jdReq = cols.includes('requirements') ? 'requirements' : null;
    jdObs = cols.includes('text_observed_at') ? 'text_observed_at' : cols.includes('fetched_at') ? 'fetched_at' : null;
    break;
  }
}
if (!jdTable) throw new Error('JD table not found in snapshot');
console.log('JD table:', jdTable, 'key:', jdKey, 'desc:', jdDesc, 'req:', jdReq, 'obs:', jdObs);
const jdSel = [jdDesc, jdReq, jdObs].filter(Boolean).map((c) => '"' + c + '"').join(',');
const jdStmt = jdDb.prepare('SELECT ' + jdSel + ' FROM "' + jdTable + '" WHERE "' + jdKey + '"=?');

/*  采样配额（理工+文科双族；实习权重高，适配在校生）  */
const QUOTA = {
  '技术': { campus: 30, intern: 20, social: 10 }, '产品': { campus: 14, intern: 8, social: 5 }, '运营': { campus: 16, intern: 10, social: 6 },
  '设计': { campus: 10, intern: 6 }, '金融': { campus: 16, intern: 6 }, '职能': { campus: 14, intern: 8 },
  '市场销售': { campus: 14, intern: 6 }, '工程制造': { campus: 16, intern: 8, social: 12 }, '医药': { campus: 10, intern: 4 },
  '教育培训': { campus: 10, intern: 4 }, '管培': { campus: 12, intern: 4 }, '科研': { campus: 8, intern: 4 },
  '项目管理': { campus: 8, intern: 4 },
};
const CAP_PER_COMPANY = 3;
const jobQuery = "SELECT j.id,j.source_job_id,j.title,j.source_id,j.url,j.category,j.subcategory,j.recruit_type,j.grad_year,j.batch,j.cities,j.degree_min,j.publish_at,j.first_seen,j.last_seen,j.apply_end,c.name company " +
  "FROM job j JOIN company c ON c.id=j.company_id ";
const candStmt = jobsDb.prepare(jobQuery +
  "WHERE j.category=? AND j.recruit_type=? AND j.closed_at IS NULL " +
  "ORDER BY j.last_seen DESC, (j.cities!='[]') DESC, j.publish_at DESC, j.id LIMIT 2000");
// These company sources correspond to public portals on the shared recruitment-leads tab.
const leadSources = ['beisen-pudutech','agirobot','li'];
const leadInternships = jobsDb.prepare(jobQuery +
  "WHERE j.source_id=? AND j.recruit_type='intern' AND j.closed_at IS NULL " +
  "ORDER BY j.publish_at DESC, j.last_seen DESC, j.id LIMIT 40");

function linkScope(row) {
  if (row.source_id.startsWith('jysd-')) return 'school_notice';
  const url = new URL(row.url);
  if (/\/detail(?:\/|$)|\/position\/[^/]+|\/job\/[^/]+|\/jobs\/[^/]+/i.test(url.pathname) ||
    [...url.searchParams.keys()].some(key => /^(jobAdId|jobId|postId|positionId)$/i.test(key))) return 'job_detail';
  if (url.pathname === '/') return 'company_career_home';
  return 'unknown';
}

function sample(cat, type, quota) {
  const rows = candStmt.all(cat, type);
  const byCompany = new Map();
  for (const r of rows) { if (!byCompany.has(r.company)) byCompany.set(r.company, []); byCompany.get(r.company).push(r); }
  const picked = [], counts = new Map();
  let added = true;
  while (picked.length < quota && added) {
    added = false;
    for (const [comp, arr] of byCompany) {
      const n = counts.get(comp) || 0;
      if (n < CAP_PER_COMPANY && n < arr.length) { picked.push(arr[n]); counts.set(comp, n + 1); added = true; if (picked.length >= quota) break; }
    }
  }
  return picked;
}

const jobs = [];
const seen = new Set();
let zeroSkill = 0, noJd = 0, withSalary = 0;
const catDist = {}, compSet = new Set(), indDist = {};
function addJob(r, jd, { requirePay = false, allowUnmatchedSkills = false } = {}) {
      if (!r || seen.has(r.id) || !/^https?:\/\//i.test(r.url || '') || !URL.canParse(r.url)) return false;
      if (r.apply_end && r.apply_end.slice(0, 10) < snapshotDate) return false;
      const desc = jd && jdDesc ? (jd[jdDesc] || '').trim() : '';
      const req = jd && jdReq ? (jd[jdReq] || '').trim() : '';
      if (!desc && !req) { noJd++; return false; }
      const jdText = desc + (req ? '\n\n【任职要求】\n' + req : '');
      const salary = CC.salaryParse(jdText);
      if (requirePay && !salary) return false;
      const core = CC.parseJdCore(NEUTRAL_P, jdText);
      const skills = core.skills.map((s) => ({ skillId: s.skillId, weight: s.weight }));
      if (!skills.length && !allowUnmatchedSkills) { zeroSkill++; return false; }
      seen.add(r.id);
      if (salary) withSalary++;
      const cities = (() => { try { return JSON.parse(r.cities || '[]'); } catch (e) { return []; } })();
      const industry = industryOf(r.company);
      const isIntern = r.recruit_type === 'intern' || /实习生|\bintern\b/i.test(r.title);
      const type = isIntern ? 'intern' : r.recruit_type;
      const exp = isIntern ? '在校实习' : type === 'social' ? '社招' : '应届';
      const recruitLabel = isIntern ? '实习' : type === 'social' ? '社招' : '校招';
      const gy = r.grad_year ? [r.grad_year] : [];
      const id = 'jr_' + (CC.djb2(r.id) >>> 0).toString(36);
      const benefits = benefitsOf(jdText);
      const period = isIntern ? internPeriodOf(jdText) : null;
      jobs.push({
        id, schemaVersion: CC.EMPLOYMENT_SCHEMA_VERSION, title: r.title, org: r.company, jobType: type,
        orgLabel: r.company + ' · ' + (r.batch || recruitLabel),
        category: r.category || '其他', subCategory: r.subcategory || '',
        recruitmentType: recruitLabel + (r.batch ? ' · ' + r.batch : ''),
        majors: CAT_MAJORS[r.category] || [],
        locations: cities, experience: exp,
        degree: r.degree_min || null,
        salary,
        industry, companyType: companyTypeOf(industry),
        benefits, internshipPeriod: period,
        companyIntro: null,
        hardGate: {
          graduationYears: gy, minGpaPercent: null, maxRankPercent: null,
          minDegree: DEGREE_GATE[r.degree_min] || null, englishRequirement: null,
          otherGates: isIntern ? ['需核实在校生身份'] : type === 'campus' ? ['需核实应届身份及届别'] : [],
        },
        skills, bonusEvidenceTypes: (core.deliverables || []).slice(0, 4),
        jdText, jdHash: createHash('sha256').update(jdText).digest('hex'), postUrl: r.url, isBenchmarkModel: false, snapshotDate,
        sourceSnapshot: {
          sourceId: r.source_id, sourceJobId: r.source_job_id, sourceReportedJobType: r.recruit_type, via: 'jobradar', linkScope: linkScope(r),
          snapshotAt, firstSeenAt: r.first_seen || null, lastSeenAt: r.last_seen || null,
          sourceLastOkAt: sourceSeen.get(r.source_id) || null, textObservedAt: jdObs ? jd[jdObs] || null : null,
          applyEndAt: r.apply_end || null, status: r.last_seen ? 'observed_active' : 'unknown',
        },
        citation: {
          sourceName: r.company + '招聘（' + (tierOf(r.source_id) === 'A_OFFICIAL' ? '官网/ATS 公开渠道' : '高校就业网聚合') + '）',
          sourceUrl: r.url, publishDate: r.publish_at || null, verifiedDate: null,
          trustTier: tierOf(r.source_id),
          note: 'JobRadar 本地快照。招聘状态按原始观测和截止日期计算。',
        },
        remote: /(?:岗位支持|可选择|可接受|支持)(?:全程)?远程(?:办公|工作|实习)|(?:工作方式|办公方式)\s*[:：]\s*远程/.test(jdText) ? true : null,
      });
      catDist[r.category] = (catDist[r.category] || 0) + 1;
      compSet.add(r.company);
      const ik = industry || '未收录'; indDist[ik] = (indDist[ik] || 0) + 1;
      return true;
}
for (const [cat, quotas] of Object.entries(QUOTA)) {
  for (const [type, quota] of Object.entries(quotas)) {
    const picked = sample(cat, type, quota);
    for (const row of picked) addJob(row, jdStmt.get(row.id));
    console.log('  ', cat, type, 'picked', picked.length, 'cum', jobs.length);
  }
}

// Keep a small, diverse set of postings that disclose comparable pay in the original JD.
const payPatterns = ['%薪资%', '%日薪%', '%月薪%', '%薪酬%', '%工资%'];
const payColumns = [jdDesc, jdReq].filter(Boolean);
const payWhere = payColumns.flatMap(field => payPatterns.map(() => '"' + field + '" LIKE ?')).join(' OR ');
const payScan = jdDb.prepare('SELECT "' + jdKey + '", ' + jdSel + ' FROM "' + jdTable + '" WHERE ' + payWhere + ' ORDER BY "' + jdKey + '"');
const jobBySourceId = jobsDb.prepare(jobQuery + 'WHERE j.id=? AND j.closed_at IS NULL');
const paidCompanies = new Map();
for (const jd of payScan.iterate(...payColumns.flatMap(() => payPatterns))) {
  if (withSalary >= 24) break;
  const row = jobBySourceId.get(jd[jdKey]);
  if (!row || (paidCompanies.get(row.company) || 0) >= 2 || !['campus','intern','social'].includes(row.recruit_type)) continue;
  if (addJob(row, jd, { requirePay: true })) paidCompanies.set(row.company, (paidCompanies.get(row.company) || 0) + 1);
}

// Supplement the general quotas with concrete internships behind the curated employer leads.
for (const sourceId of leadSources) {
  let count=jobs.filter(job=>job.sourceSnapshot.sourceId===sourceId && job.jobType==='intern').length;
  for (const row of leadInternships.all(sourceId)) {
    if (count>=8) break;
    if (!URL.canParse(row.url) || linkScope(row)!=='job_detail') continue;
    if (/(?:合集|投递专岗|统一投递|人才库)/.test(row.title)) continue;
    if (addJob(row,jdStmt.get(row.id),{allowUnmatchedSkills:true})) count++;
  }
  console.log('  线索来源实习',sourceId,count);
}

console.log('=== JobRadar 样本完成 ===');
console.log('岗位', jobs.length, '公司', compSet.size, '零技能跳过', zeroSkill, '无JD跳过', noJd, '有明示薪资', withSalary);
console.log('类别分布', JSON.stringify(catDist));
console.log('行业分布', JSON.stringify(indDist));
const sc = jobs.map((j) => j.skills.length);
console.log('技能数 min/avg/max', Math.min(...sc), (sc.reduce((a, b) => a + b, 0) / sc.length).toFixed(1), Math.max(...sc));
console.log('届别分布', JSON.stringify(jobs.reduce((a, j) => { const k = j.hardGate.graduationYears[0] || '未写'; a[k] = (a[k] || 0) + 1; return a; }, {})));
console.log('学历分布', JSON.stringify(jobs.reduce((a, j) => { const k = j.degree || '未写'; a[k] = (a[k] || 0) + 1; return a; }, {})));
// Recheck existing identities independently of the display quotas and the JD database.
const statusBySourceId=jobsDb.prepare('SELECT source_id,source_job_id,last_seen,closed_at,apply_end FROM job WHERE source_id=? AND source_job_id=?');
const observations=data.jobs.flatMap(job=>{
  const source=job.sourceSnapshot;
  if(source?.via!=='jobradar') return [];
  const row=statusBySourceId.get(source.sourceId,source.sourceJobId);
  if(!row) return [];
  return [{sourceId:row.source_id,sourceJobId:row.source_job_id,closedAt:row.closed_at,
    lastSeenAt:row.last_seen,applyEndAt:row.apply_end,sourceLastOkAt:sourceSeen.get(row.source_id)||null}];
});
writeEmploymentFile(new URL('./jobradar-jobs.json',import.meta.url),
  JSON.stringify({format:'course-compass-jobradar-v1',snapshotAt,jobs,observations},null,1));
console.log('已写 jobradar-jobs.json', jobs.length, '条岗位，',observations.length,'条既有岗位状态观测');
} finally {
  jdDb?.close();
  jobsDb.close();
  if (tmp) {
    const unpacked = join(tmp, 'jd_text.db');
    if (existsSync(unpacked)) await unlink(unpacked);
    await rmdir(tmp);
  }
}
