/* _fetch-jobs.mjs — dev-time 真实岗位抓取（腾讯校招 join.qq.com 公开接口）。
 * 合规：仅公开 JSON 接口，无登录/签名绕过；限速≥2000ms；失败重试一次后跳过，绝不编造。
 * 产出 real-jobs.json（真实 title/职责/要求/加分项/城市/类别/真实详情URL），确定性抽取技能与门槛。
 * 运行：node _fetch-jobs.mjs  （随后 node _build-inline.mjs 内联） */
import { readFileSync, writeFileSync } from 'node:fs';

const ROOT = 'D:/course-compass-review';
const BASE = 'https://join.qq.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const H = { 'User-Agent': UA, 'Referer': BASE + '/post.html', 'Accept': 'application/json' };
const DELAY = 2000;
const TODAY = new Date().toISOString().slice(0, 10);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* 载入引擎以复用确定性技能抽取（与 _smoke.mjs 同法） */
const data = JSON.parse(readFileSync(ROOT + '/_cc-data.json', 'utf8'));
global.window = {};
window.CC_DATA = data;
eval(readFileSync(ROOT + '/_cc-engine.js', 'utf8'));
const CC = window.CC;
const NEUTRAL_P = { major: 'chinese', graduationYear: 2028, gpaPercent: 0, rank: null, completedCourseIds: [], evidences: [], weeklyHours: 8 };

async function getJSON(url, opt = {}) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, { headers: H, ...opt });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const j = await res.json();
      if (j.status !== 0) throw new Error('api status ' + j.status + ' ' + (j.message || ''));
      return j;
    } catch (e) {
      if (attempt === 1) { console.error('  SKIP', url.slice(0, 90), e.message); return null; }
      await sleep(DELAY);
    }
  }
}

/* 类别(fid)→适合专业（确定性推断，用于跨专业匹配标记，非岗位事实） */
const FID_MAJORS = {
  75: ['cs', 'mat_mech'], 76: ['cs', 'mat_mech'], 77: ['cs'], 84: ['cs'], 93: ['cs', 'mat_mech'], 231: ['cs', 'econ'], 250: ['mat_mech', 'cs'],
  79: ['cs', 'econ'], 80: ['cs', 'chinese'], 83: ['chinese'], 94: ['cs', 'econ', 'chinese'], 219: ['econ'], 253: ['cs', 'econ'],
  85: ['chinese', 'cs'], 89: ['chinese', 'cs'],
  78: ['econ'], 82: ['econ', 'chinese'], 96: ['chinese'], 192: ['econ', 'chinese'],
  326: ['econ'], 327: ['chinese', 'econ'], 328: ['chinese'], 329: ['chinese', 'econ'],
  751: ['cs'], 752: ['cs'], 753: ['cs'], 754: ['cs'], 755: ['cs', 'mat_mech'], 756: ['cs', 'mat_mech'], 757: ['cs'],
};
const TID_MAJORS = { 2: ['cs', 'mat_mech'], 3: ['cs', 'econ', 'chinese'], 4: ['chinese', 'cs'], 5: ['econ', 'chinese'], 6: ['econ', 'chinese'], 7: ['cs', 'mat_mech'] };

/* 每家族采样配额（理工+文科双族广度） */
const QUOTA = { 2: 28, 7: 16, 3: 18, 4: 8, 5: 16, 6: 19 };

async function main() {
  console.log('=== 真实岗位抓取（腾讯校招公开接口）', TODAY, '===');

  /* 1. 类别字典 fid→title */
  const famJ = await getJSON(BASE + '/api/v1/position/getPositionFamily');
  const fidTitle = {};
  if (famJ && famJ.data) for (const k of Object.keys(famJ.data)) for (const x of famJ.data[k]) fidTitle[x.id] = x.title;
  console.log('类别字典', Object.keys(fidTitle).length, '项');
  await sleep(DELAY);

  /* 2. 分页拉取应届列表（公开默认项目），按 positionFamily 分桶 */
  const buckets = {};
  let page = 1, total = Infinity, got = 0;
  const projDist = {};
  while (got < total && page <= 12) {
    const j = await getJSON(BASE + '/api/v1/position/searchPosition', {
      method: 'POST', headers: { ...H, 'Content-Type': 'application/json' },
      body: JSON.stringify({ pageIndex: page, pageSize: 100, keyword: '' }),
    });
    if (!j || !j.data) break;
    total = j.data.count || 0;
    const L = j.data.positionList || [];
    if (!L.length) break;
    for (const it of L) {
      projDist[it.projectName] = (projDist[it.projectName] || 0) + 1;
      const fam = it.positionFamily;
      (buckets[fam] = buckets[fam] || []).push(it);
    }
    got += L.length;
    console.log('  list page', page, 'got', L.length, 'cum', got, '/', total);
    page++;
    await sleep(DELAY);
  }
  console.log('列表项目分布', JSON.stringify(projDist));
  console.log('家族桶', Object.keys(buckets).map((k) => k + ':' + buckets[k].length).join(' '));

  /* 3. 跨家族采样（按标题去重，均匀 spread） */
  const sampled = [];
  for (const fam of Object.keys(QUOTA)) {
    const arr = buckets[fam] || [];
    const seen = new Set();
    const uniq = arr.filter((it) => { const t = it.positionTitle.trim(); if (seen.has(t)) return false; seen.add(t); return true; });
    const quota = QUOTA[fam];
    const step = Math.max(1, Math.floor(uniq.length / quota));
    const pick = [];
    for (let i = 0; i < uniq.length && pick.length < quota; i += step) pick.push(uniq[i]);
    console.log('  fam', fam, 'uniq', uniq.length, 'pick', pick.length);
    sampled.push(...pick);
  }
  console.log('采样总数', sampled.length);

  /* 4. 逐岗抓详情（限速），确定性抽取技能/门槛，构造真实需求实体 */
  const jobs = [];
  let zeroSkill = 0;
  for (let i = 0; i < sampled.length; i++) {
    const it = sampled[i];
    const j = await getJSON(BASE + '/api/v1/jobDetails/getJobDetailsByPostId?postId=' + encodeURIComponent(it.postId));
    await sleep(DELAY);
    if (!j || !j.data) continue;
    const d = j.data;
    const desc = (d.desc || '').trim();
    const request = (d.request || '').trim();
    if (!desc && !request) { console.log('  无JD跳过', d.title); continue; }
    const bonus = (d.graduateBonus || d.internBonus || '').trim();
    const jdText = desc + (request ? '\n\n【任职要求】\n' + request : '') + (bonus ? '\n\n【加分项】\n' + bonus : '');
    const core = CC.parseJdCore(NEUTRAL_P, jdText);
    let skills = core.skills.map((s) => ({ skillId: s.skillId, weight: s.weight }));
    if (!skills.length) zeroSkill++;
    const fam = d.tid;
    const majors = FID_MAJORS[d.fid] || TID_MAJORS[fam] || ['chinese', 'cs', 'econ', 'mat_mech'];
    const isIntern = /实习/.test(d.projectName || '');
    const postUrl = BASE + '/post.html?query=p_' + d.postId;
    const deliverables = (core.deliverables && core.deliverables.length) ? core.deliverables.slice(0, 4) : [];
    jobs.push({
      id: 'tx_' + d.postId,
      title: d.title,
      org: '腾讯',
      orgLabel: '腾讯校招 · ' + (d.projectName || '应届毕业生'),
      category: d.tidName || '其他',
      subCategory: fidTitle[d.fid] || '',
      recruitmentType: d.projectName || '应届毕业生',
      majors,
      locations: (d.workCityList || []).map((c) => c.replace('总部', '')).filter(Boolean),
      experience: isIntern ? '在校实习' : '应届',
      degree: null,
      salary: null,
      hardGate: {
        graduationYears: [],
        minGpaPercent: null, maxRankPercent: null, minDegree: null, englishRequirement: null,
        otherGates: [isIntern ? '在校生实习身份' : '应届毕业生身份（校招）'],
      },
      skills,
      bonusEvidenceTypes: deliverables,
      jdText,
      postUrl,
      isBenchmarkModel: false,
      snapshotDate: TODAY,
      citation: {
        sourceName: '腾讯校招 · ' + (d.projectName || '应届毕业生'),
        sourceUrl: postUrl,
        publishDate: null,
        verifiedDate: TODAY,
        trustTier: 'A_OFFICIAL',
        note: '官网公开接口真实抓取；单岗发布日期官网未公开，以核实日为准。',
      },
    });
    if ((i + 1) % 10 === 0) console.log('  detail', i + 1, '/', sampled.length, 'jobs', jobs.length, 'zeroSkill', zeroSkill);
  }

  console.log('=== 完成：真实岗位', jobs.length, '条；零技能', zeroSkill, '条 ===');
  const catDist = {};
  jobs.forEach((j) => { catDist[j.category] = (catDist[j.category] || 0) + 1; });
  console.log('类别分布', JSON.stringify(catDist));
  const skillCounts = jobs.map((j) => j.skills.length);
  console.log('技能数 min/avg/max', Math.min(...skillCounts), (skillCounts.reduce((a, b) => a + b, 0) / skillCounts.length).toFixed(1), Math.max(...skillCounts));
  writeFileSync(ROOT + '/real-jobs.json', JSON.stringify(jobs, null, 1));
  console.log('已写 real-jobs.json', jobs.length, '条');
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });