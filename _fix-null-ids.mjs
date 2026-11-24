import { readFileSync, writeFileSync, copyFileSync } from 'node:fs';

// 修复官网列表未公开 postId 的岗位（项目实习生）：id 撞车 tx_null + 详情 URL p_null 失效。
// 原则：JD 原文真实保留；不臆造 URL，溯源指向真实抓取入口 join.qq.com，并显式标注。
function djb2(str) { let h = 5381; for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0; return h; }
const CAMPUS = 'https://join.qq.com';
const NOTE = '项目制实习生：官网列表未公开独立 postId，JD 原文来自官网详情接口；溯源指向腾讯校招官网入口（真实抓取源），非臆造详情链接。';

function fix(jobs) {
  let n = 0;
  for (const j of jobs) {
    const badId = j.id === 'tx_null' || j.id === 'tx_undefined' || /p_(null|undefined)/.test(j.postUrl || '');
    if (!badId) continue;
    n++;
    j.id = 'tx_proj_' + (djb2(j.title + '|' + (j.category || '')) >>> 0).toString(36);
    j.postUrl = CAMPUS;
    if (j.citation) { j.citation.sourceUrl = CAMPUS; j.citation.note = NOTE; }
  }
  return n;
}

for (const file of ['real-jobs.json', '_cc-data.json']) {
  const path = 'D:/course-compass-review/' + file;
  const d = JSON.parse(readFileSync(path, 'utf8'));
  const jobs = Array.isArray(d) ? d : d.jobs;
  copyFileSync(path, path.replace('.json', '.prenullfix.bak.json'));
  const n = fix(jobs);
  const ids = jobs.map((j) => j.id);
  const uniq = new Set(ids).size;
  const badUrl = jobs.filter((j) => !j.postUrl || /p_(null|undefined)/.test(j.postUrl)).length;
  writeFileSync(path, JSON.stringify(d, null, Array.isArray(d) ? 1 : 2));
  console.log(file, 'fixed', n, 'jobs', jobs.length, 'uniqIds', uniq, 'badUrl', badUrl);
}