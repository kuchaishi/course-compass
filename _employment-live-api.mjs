import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { employmentEngine, jobLinkIdentity, normalizePosting, readEmploymentData } from './_employment-data.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const DEFAULT_JOBS_DB = join(ROOT, '_research', 'jobs.db');
const DEFAULT_CALENDAR_DB = join(ROOT, '_research', 'calendar.db');
const DEFAULT_JD_TEXT_DB = process.env.CC_JD_TEXT_DB ||
  'C:/Users/Administrator/.gemini/antigravity/brain/e7a3f14c-423f-445c-9da3-9e88637eb57f/scratch/jd_text.db';

const LIVE_SOURCES = [
  { id: 'tencent', name: '腾讯校招官方接口 (join.qq.com)', kind: 'public_ats', region: '中国', description: '腾讯校招与实习生公开职位检索及详情直连' },
  { id: 'smartrecruiters', name: 'SmartRecruiters 名企官方 ATS', kind: 'public_ats', region: '中国/全球', boards: ['BoschGroup', 'Continental'], description: '博世、大陆集团等跨国名企公开 ATS 实时岗位' },
  { id: 'greenhouse', name: 'Greenhouse 全球独角兽 ATS', kind: 'public_ats', region: '全球/远程', boards: ['cloudflare', 'airbnb'], description: 'Cloudflare、Airbnb 等工程与产品团队公开岗位' },
];

const UA = 'CourseCompass/2.0 (Educational Career Planner; +https://course-compass.local)';

function stripHtml(html) {
  if (!html) return '';
  return String(html)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function inferMajorsFromSkills(engine, skills, title = '') {
  const set = new Set(skills.map(s => s.skillId));
  const out = new Set();
  for (const dir of engine.CAREER_DIRECTIONS || []) {
    if ((dir.coreSkills || []).some(id => set.has(id))) out.add(dir.major);
  }
  if (/硬件|机械|车辆|电子|嵌入式|控制|芯片|plc/i.test(title)) out.add('mat_mech');
  if (!out.size) out.add('cs');
  return [...out];
}

function buildNormalizedPosting(raw, engine) {
  const today = new Date().toISOString().slice(0, 10);
  const jdText = String(raw.jdText || '').trim().slice(0, 5800) || `${raw.title}（${raw.org}）官方实时发布岗位。`;
  const extracted = engine.extractSkillsFromText(`${raw.title}\n${jdText}`);
  const uniqueExtracted = [...new Map(extracted.map(s => [s.skillId, s])).values()];
  const skills = (uniqueExtracted.length ? uniqueExtracted : [{ skillId: 'teamwork_comm', weight: 0.4 }])
    .slice(0, 8)
    .map((s, idx) => ({ skillId: s.skillId, weight: idx < 2 ? 0.85 : 0.45 }));
  const hardGate = engine.extractHardGateObject(jdText, raw.hardGate || {});
  const salary = engine.salaryParse(jdText);
  const validSalary = salary && salary.min <= salary.max && salary.monthlyMin <= salary.monthlyMax &&
    salary.sourceSpan && salary.sourceSpan.includes(salary.raw) && jdText.includes(salary.sourceSpan) ? salary : null;
  const degZh = { associate: '大专', bachelor: '本科', master: '硕士', phd: '博士' };

  const posting = normalizePosting({
    id: raw.id,
    schemaVersion: engine.EMPLOYMENT_SCHEMA_VERSION,
    title: raw.title,
    org: raw.org,
    orgLabel: `${raw.org} · 实时官网同步`,
    category: raw.category || '技术',
    subCategory: raw.subCategory || raw.jobTypeLabel || '校招/实习',
    recruitmentType: raw.jobType === 'intern' ? '实习' : '校招',
    jobType: raw.jobType || (/实习|intern/i.test(raw.title) ? 'intern' : 'campus'),
    locations: raw.locations?.length ? raw.locations : ['全国'],
    experience: raw.jobType === 'intern' ? '在校实习' : '应届',
    degree: degZh[hardGate.minDegree] || null,
    majors: raw.majors?.length ? raw.majors : inferMajorsFromSkills(engine, skills, raw.title),
    skills,
    bonusEvidenceTypes: ['自研项目仓库（GitHub + 压测/运行结果）/ 竞赛 / 实习交付物'],
    hardGate,
    jdText,
    postUrl: raw.postUrl,
    salary: validSalary,
    industry: raw.industry || null,
    snapshotDate: today,
    citation: {
      sourceName: raw.sourceName,
      sourceUrl: raw.postUrl,
      publishDate: raw.publishDate || null,
      verifiedDate: today,
      trustTier: 'A_OFFICIAL',
      note: '实时调用官网公开 ATS 接口同步，点击申请入口直达官方原页。',
    },
    sourceSnapshot: {
      sourceId: raw.sourceId,
      snapshotAt: today,
      lastSeenAt: today,
      status: 'confirmed_active',
      linkScope: 'job_detail',
      via: raw.via || raw.sourceId,
      applyUrl: raw.postUrl,
    },
  }, engine);
  if (!posting.salary || !posting.jdText.includes(posting.salary.sourceSpan)) posting.salary = null;
  return posting;
}

async function fetchTencentLive({ keyword = '', limit = 6, fetcher, engine }) {
  const res = await fetcher('https://join.qq.com/api/v1/position/searchPosition', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Referer': 'https://join.qq.com/post.html', 'User-Agent': UA },
    body: JSON.stringify({ pageIndex: 1, pageSize: Math.min(20, Math.max(limit * 2, 10)), keyword }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res?.ok) throw new Error(`Tencent HTTP ${res?.status}`);
  const payload = await res.json();
  const list = (payload?.data?.positionList || []).slice(0, limit);
  const items = [];
  for (const row of list) {
    let jdText = '';
    let postId = row.postId || row.id;
    let loc = row.workCities || row.cityName || '深圳';
    try {
      const dRes = await fetcher(`https://join.qq.com/api/v1/jobDetails/getJobDetailsByPostId?postId=${encodeURIComponent(postId)}`, {
        headers: { 'Referer': 'https://join.qq.com/post.html', 'Accept': 'application/json', 'User-Agent': UA },
        signal: AbortSignal.timeout(6000),
      });
      if (dRes?.ok) {
        const dJson = await dRes.json();
        const d = dJson?.data;
        if (d) {
          jdText = [d.desc, d.request ? `【任职要求】\n${d.request}` : '', d.graduateBonus || d.internBonus ? `【加分项】\n${d.graduateBonus || d.internBonus}` : '']
            .filter(Boolean).join('\n\n');
          if (d.workCityList?.length) loc = d.workCityList;
        }
      }
    } catch {}
    if (!jdText && row.desc) jdText = `${row.desc}\n${row.request || ''}`.trim();
    const locations = Array.isArray(loc) ? loc.slice(0, 5) : String(loc || '深圳').split(/[,，/\s]+/).filter(Boolean).slice(0, 5);
    const isIntern = /实习/.test((row.projectName || '') + ' ' + (row.positionTitle || ''));
    items.push(buildNormalizedPosting({
      id: `live_tx_${postId}`,
      title: row.positionTitle || row.title || '腾讯校招岗位',
      org: '腾讯',
      category: row.tidName || '技术',
      subCategory: row.projectName || '腾讯实时校招',
      jobType: isIntern ? 'intern' : 'campus',
      locations,
      jdText: jdText || `${row.positionTitle || ''}（${row.projectName || '腾讯校招'}）`,
      postUrl: `https://join.qq.com/post.html?query=p_${postId}`,
      sourceName: `腾讯校招实时官网 · ${row.projectName || '应届/实习'}`,
      sourceId: 'live_tencent',
      industry: '互联网与软件',
      publishDate: typeof row.publishTime === 'string' && /^\d{4}-\d{2}-\d{2}/.test(row.publishTime) ? row.publishTime.slice(0, 10) : null,
      via: 'tencent_live',
    }, engine));
  }
  return items;
}

async function fetchSmartRecruitersLive({ keyword = '', limit = 6, fetcher, engine }) {
  const boards = [
    { companyId: 'BoschGroup', org: '博世', industry: '汽车与工业自动化' },
    { companyId: 'Continental', org: '大陆集团', industry: '汽车与工业自动化' },
  ];
  const kwLower = keyword.trim().toLowerCase();
  const out = [];
  for (const board of boards) {
    if (out.length >= limit) break;
    const qParam = kwLower ? `&q=${encodeURIComponent(keyword)}` : '';
    const res = await fetcher(`https://api.smartrecruiters.com/v1/companies/${board.companyId}/postings?limit=12${qParam}`, {
      headers: { Accept: 'application/json', 'User-Agent': UA },
      signal: AbortSignal.timeout(8000),
    });
    if (!res?.ok) continue;
    const json = await res.json();
    const content = json?.content || [];
    const cnFirst = [
      ...content.filter(c => /china|cn|shanghai|suzhou|beijing|wuxi|changsha/i.test(`${c.location?.country || ''} ${c.location?.city || ''} ${c.name || ''}`)),
      ...content.filter(c => !/china|cn|shanghai|suzhou|beijing|wuxi|changsha/i.test(`${c.location?.country || ''} ${c.location?.city || ''} ${c.name || ''}`)),
    ];
    for (const item of cnFirst) {
      if (out.length >= limit) break;
      if (kwLower && !`${item.name} ${item.department?.label || ''} ${item.location?.city || ''}`.toLowerCase().includes(kwLower)) continue;
      let jdText = '';
      try {
        const dRes = await fetcher(`https://api.smartrecruiters.com/v1/companies/${board.companyId}/postings/${encodeURIComponent(item.id)}`, {
          headers: { Accept: 'application/json', 'User-Agent': UA },
          signal: AbortSignal.timeout(6000),
        });
        if (dRes?.ok) {
          const d = await dRes.json();
          const sec = d?.jobAd?.sections || {};
          jdText = [
            stripHtml(sec.jobDescription?.text),
            sec.qualifications?.text ? `【任职要求】\n${stripHtml(sec.qualifications.text)}` : '',
            sec.additionalInformation?.text ? `【补充说明】\n${stripHtml(sec.additionalInformation.text)}` : '',
          ].filter(Boolean).join('\n\n');
        }
      } catch {}
      const city = item.location?.city || (item.location?.country === 'cn' ? '上海/苏州' : 'Global / China');
      const isIntern = /intern|working student|实习|trainee/i.test(item.name || '');
      out.push(buildNormalizedPosting({
        id: `live_sr_${board.companyId.toLowerCase()}_${item.id}`,
        title: item.name,
        org: board.org,
        category: '工程制造',
        subCategory: item.department?.label || '研发与工程',
        jobType: isIntern ? 'intern' : 'campus',
        locations: [city],
        jdText: jdText || `${board.org} ${item.name}（${city}）公开 ATS 职位。`,
        postUrl: item.ref ? `https://jobs.smartrecruiters.com/${board.companyId}/${item.id}` : `https://jobs.smartrecruiters.com/${board.companyId}`,
        sourceName: `${board.org} SmartRecruiters 官方 ATS`,
        sourceId: `live_sr_${board.companyId.toLowerCase()}`,
        industry: board.industry,
        publishDate: item.releasedDate ? String(item.releasedDate).slice(0, 10) : null,
        via: 'smartrecruiters',
      }, engine));
    }
  }
  return out;
}

async function fetchGreenhouseLive({ keyword = '', limit = 6, fetcher, engine }) {
  const boards = [
    { slug: 'cloudflare', org: 'Cloudflare', industry: '云计算与网络安全' },
    { slug: 'airbnb', org: 'Airbnb', industry: '互联网与全球平台' },
  ];
  const kwLower = keyword.trim().toLowerCase();
  const out = [];
  for (const board of boards) {
    if (out.length >= limit) break;
    const res = await fetcher(`https://boards-api.greenhouse.io/v1/boards/${board.slug}/jobs?content=true`, {
      headers: { Accept: 'application/json', 'User-Agent': UA },
      signal: AbortSignal.timeout(8000),
    });
    if (!res?.ok) continue;
    const json = await res.json();
    const list = json?.jobs || [];
    const prioritized = [
      ...list.filter(j => /intern|grad|university|junior|beijing|shanghai|singapore|china|apac/i.test(`${j.title} ${j.location?.name || ''}`)),
      ...list.filter(j => !/intern|grad|university|junior|beijing|shanghai|singapore|china|apac/i.test(`${j.title} ${j.location?.name || ''}`)),
    ];
    for (const item of prioritized) {
      if (out.length >= limit) break;
      const hay = `${item.title} ${item.location?.name || ''} ${item.departments?.[0]?.name || ''}`.toLowerCase();
      if (kwLower && !hay.includes(kwLower)) continue;
      const jdText = stripHtml(item.content) || `${board.org} ${item.title}（${item.location?.name || 'Remote'}）`;
      const isIntern = /intern|university|grad|fellow/i.test(item.title || '');
      out.push(buildNormalizedPosting({
        id: `live_gh_${board.slug}_${item.id}`,
        title: item.title,
        org: board.org,
        category: '技术',
        subCategory: item.departments?.[0]?.name || 'Engineering',
        jobType: isIntern ? 'intern' : 'campus',
        locations: [item.location?.name || 'Remote / APAC'].slice(0, 3),
        jdText,
        postUrl: item.absolute_url || `https://boards.greenhouse.io/${board.slug}/jobs/${item.id}`,
        sourceName: `${board.org} Greenhouse 官方 ATS`,
        sourceId: `live_gh_${board.slug}`,
        industry: board.industry,
        publishDate: item.updated_at ? String(item.updated_at).slice(0, 10) : null,
        via: 'greenhouse_live',
      }, engine));
    }
  }
  return out;
}

export function createEmploymentLiveApiHandler({
  catalogFile,
  jobsDbPath = DEFAULT_JOBS_DB,
  calendarDbPath = DEFAULT_CALENDAR_DB,
  jdTextDbPath = DEFAULT_JD_TEXT_DB,
  fetcher = fetch,
} = {}) {
  const syncCache = new Map();
  let cachedCatalog = null;
  let cachedJobsDb = null;
  let cachedCalDb = null;

  const getCatalog = () => {
    if (!cachedCatalog) {
      const data = readEmploymentData(catalogFile);
      cachedCatalog = { data, engine: employmentEngine(data) };
    }
    return cachedCatalog;
  };
  const getJobsDb = () => {
    if (cachedJobsDb !== null) return cachedJobsDb;
    if (!existsSync(jobsDbPath)) return (cachedJobsDb = false);
    try {
      const db = new DatabaseSync(jobsDbPath, { readOnly: true });
      if (existsSync(jdTextDbPath)) {
        try {
          db.exec(`ATTACH DATABASE '${jdTextDbPath.replace(/'/g, "''")}' AS jdt`);
          db._hasJdText = true;
        } catch {
          db._hasJdText = false;
        }
      }
      return (cachedJobsDb = db);
    } catch {
      return (cachedJobsDb = false);
    }
  };
  const getCalDb = () => {
    if (cachedCalDb !== null) return cachedCalDb;
    if (!existsSync(calendarDbPath)) return (cachedCalDb = false);
    try {
      return (cachedCalDb = new DatabaseSync(calendarDbPath, { readOnly: true }));
    } catch {
      return (cachedCalDb = false);
    }
  };

  return async function handleEmploymentLiveApi(request, pathname, send, readLocalJson) {
    if (!pathname.startsWith('/api/employment/live/') &&
        pathname !== '/api/employment/warehouse/search' &&
        pathname !== '/api/employment/calendar') {
      return false;
    }

    const { data, engine } = getCatalog();

    if (pathname === '/api/employment/live/sources') {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        send(405, { error: 'GET_REQUIRED' });
        return true;
      }
      const jdb = getJobsDb();
      const cdb = getCalDb();
      let warehouseTotal = data.jobs.length;
      let calendarTotal = (data.campusCalendar || []).length;
      if (jdb) {
        try { warehouseTotal = jdb.prepare('SELECT COUNT(*) c FROM job WHERE closed_at IS NULL').get().c; } catch {}
      }
      if (cdb) {
        try { calendarTotal = cdb.prepare('SELECT COUNT(*) c FROM entry').get().c; } catch {}
      }
      send(200, {
        ok: true,
        sources: LIVE_SOURCES,
        warehouse: { available: Boolean(jdb), mode: jdb ? 'sqlite_318k' : 'catalog_snapshot', totalOpenJobs: warehouseTotal },
        calendar: { available: Boolean(cdb) || Boolean(data.campusCalendar?.length), totalEntries: calendarTotal },
      });
      return true;
    }

    if (pathname === '/api/employment/live/sync') {
      if (request.method !== 'POST') {
        send(405, { error: 'POST_REQUIRED' });
        return true;
      }
      const input = await readLocalJson({ maxBytes: 16384 });
      if (!input.ok) {
        send(input.status, { error: input.error });
        return true;
      }
      const body = input.value && typeof input.value === 'object' ? input.value : {};
      const requested = Array.isArray(body.sources) && body.sources.length
        ? body.sources.filter(s => ['tencent', 'smartrecruiters', 'greenhouse'].includes(s))
        : ['tencent', 'smartrecruiters', 'greenhouse'];
      const keyword = String(body.keyword || '').trim().slice(0, 60);
      const limitPerSource = Math.min(8, Math.max(2, Number(body.limit) || 5));

      const cacheKey = `${requested.join(',')}|${keyword}|${limitPerSource}`;
      const hit = syncCache.get(cacheKey);
      if (hit && Date.now() - hit.at < 60_000) {
        send(200, { ...hit.payload, cached: true });
        return true;
      }

      const runners = {
        tencent: () => fetchTencentLive({ keyword, limit: limitPerSource, fetcher, engine }),
        smartrecruiters: () => fetchSmartRecruitersLive({ keyword, limit: limitPerSource, fetcher, engine }),
        greenhouse: () => fetchGreenhouseLive({ keyword, limit: limitPerSource, fetcher, engine }),
      };

      const sourceStats = {};
      const allItems = [];
      const seenLinks = new Set();
      const settled = await Promise.allSettled(requested.map(async src => {
        const t0 = Date.now();
        try {
          const items = await runners[src]();
          sourceStats[src] = { status: 'ok', count: items.length, latencyMs: Date.now() - t0 };
          return items;
        } catch (err) {
          sourceStats[src] = { status: 'degraded', count: 0, error: err?.message || 'FETCH_ERROR', latencyMs: Date.now() - t0 };
          return [];
        }
      }));

      for (const r of settled) {
        if (r.status !== 'fulfilled') continue;
        for (const item of r.value) {
          const key = jobLinkIdentity(item) || item.id;
          if (seenLinks.has(key)) continue;
          seenLinks.add(key);
          allItems.push(item);
        }
      }

      const payload = {
        ok: true,
        syncedAt: new Date().toISOString(),
        cached: false,
        sourceStats,
        count: allItems.length,
        items: allItems,
      };
      if (allItems.length > 0) syncCache.set(cacheKey, { at: Date.now(), payload });
      send(200, payload);
      return true;
    }

    if (pathname === '/api/employment/warehouse/search') {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        send(405, { error: 'GET_REQUIRED' });
        return true;
      }
      const url = new URL(request.url, 'http://127.0.0.1');
      const q = (url.searchParams.get('q') || '').trim().slice(0, 80);
      const company = (url.searchParams.get('company') || '').trim().slice(0, 60);
      const city = (url.searchParams.get('city') || '').trim().slice(0, 40);
      const recruitType = (url.searchParams.get('recruitType') || '').trim();
      const gradYear = url.searchParams.get('gradYear') ? Number(url.searchParams.get('gradYear')) : null;
      const limit = Math.min(50, Math.max(1, Number(url.searchParams.get('limit')) || 24));

      const jdb = getJobsDb();
      if (!jdb) {
        // Slim cloud deploy fallback: search built-in enriched catalog
        const kw = q.toLowerCase();
        const filtered = data.jobs.filter(j => {
          if (company && !String(j.org || '').includes(company)) return false;
          if (city && !(j.locations || []).some(l => l.includes(city))) return false;
          if (recruitType && engine.jobTypeOf(j) !== recruitType) return false;
          if (gradYear && (j.hardGate?.graduationYears || []).length && !j.hardGate.graduationYears.includes(gradYear)) return false;
          if (kw && !`${j.title} ${j.org} ${j.category || ''} ${j.jdText || ''}`.toLowerCase().includes(kw)) return false;
          return true;
        });
        send(200, {
          ok: true,
          mode: 'catalog_snapshot',
          totalWarehouseJobs: data.jobs.length,
          matchedCount: filtered.length,
          items: filtered.slice(0, limit),
        });
        return true;
      }

      const conds = ['j.closed_at IS NULL', `j.url LIKE 'http%'`];
      const params = [];
      if (recruitType && ['campus', 'intern', 'social'].includes(recruitType)) {
        conds.push('j.recruit_type = ?');
        params.push(recruitType);
      } else {
        conds.push(`j.recruit_type IN ('campus', 'intern')`);
      }
      if (company) {
        conds.push('c.name LIKE ?');
        params.push(`%${company}%`);
      }
      if (city) {
        conds.push('j.cities LIKE ?');
        params.push(`%${city}%`);
      }
      if (gradYear && Number.isFinite(gradYear)) {
        conds.push('j.grad_year = ?');
        params.push(gradYear);
      }
      const asciiWordTokens = [];
      if (q) {
        const orGroups = q.split(/[|｜、,，]+/).map(s => s.trim()).filter(Boolean).slice(0, 5);
        if (orGroups.length > 1) {
          const orSql = [];
          for (const g of orGroups) {
            orSql.push(`(j.title LIKE ? OR c.name LIKE ? OR COALESCE(j.category, '') LIKE ? OR COALESCE(j.department, '') LIKE ?)`);
            params.push(`%${g}%`, `%${g}%`, `%${g}%`, `%${g}%`);
            if (/^[a-z0-9+#._-]{2,8}$/i.test(g)) asciiWordTokens.push(g);
          }
          conds.push('(' + orSql.join(' OR ') + ')');
        } else {
          const andTokens = q.split(/\s+/).filter(Boolean).slice(0, 4);
          for (const tk of andTokens) {
            conds.push(`(j.title LIKE ? OR c.name LIKE ? OR COALESCE(j.category, '') LIKE ? OR COALESCE(j.department, '') LIKE ?)`);
            params.push(`%${tk}%`, `%${tk}%`, `%${tk}%`, `%${tk}%`);
            if (/^[a-z0-9+#._-]{2,8}$/i.test(tk)) asciiWordTokens.push(tk);
          }
        }
      }

      const whereSql = conds.join(' AND ');
      const totalOpen = jdb.prepare('SELECT COUNT(*) c FROM job WHERE closed_at IS NULL').get().c;
      const matchedCount = jdb.prepare(`SELECT COUNT(*) c FROM job j JOIN company c ON j.company_id = c.id WHERE ${whereSql}`).get(...params).c;

      const selectCols = jdb._hasJdText
        ? `j.id AS wh_id, c.name AS company, j.source_id, j.url, j.title, j.category, j.subcategory, j.recruit_type, j.grad_year, j.batch, j.cities, j.degree_min, j.department, j.last_seen, j.apply_end, j.publish_at, t.description, t.requirements`
        : `j.id AS wh_id, c.name AS company, j.source_id, j.url, j.title, j.category, j.subcategory, j.recruit_type, j.grad_year, j.batch, j.cities, j.degree_min, j.department, j.last_seen, j.apply_end, j.publish_at, NULL AS description, NULL AS requirements`;
      const joinJd = jdb._hasJdText ? 'LEFT JOIN jdt.job_text t ON t.job_id = j.id' : '';
      const orderJdBoost = jdb._hasJdText ? '(CASE WHEN t.description IS NOT NULL OR t.requirements IS NOT NULL THEN 1 ELSE 0 END) DESC, ' : '';
      const fetchLimit = Math.min(240, Math.max(limit * 5, 80));

      const rawRows = jdb.prepare(`
        SELECT ${selectCols}
        FROM job j
        JOIN company c ON j.company_id = c.id
        ${joinJd}
        WHERE ${whereSql}
        ORDER BY ${orderJdBoost}(CASE WHEN j.grad_year IN (2027, 2028) THEN 1 ELSE 0 END) DESC, j.last_seen DESC
        LIMIT ?
      `).all(...params, fetchLimit);

      const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const asciiRes = asciiWordTokens.map(tk => new RegExp('(?<![a-z0-9])' + escapeRe(tk) + '(?![a-z0-9])', 'i'));
      const seenKeys = new Set();
      const rows = [];
      for (const r of rawRows) {
        if (asciiRes.length) {
          const hay = `${r.title || ''} ${r.company || ''} ${r.category || ''} ${r.department || ''}`;
          const anyMatch = q.includes('|') || q.includes('、') || q.includes(',')
            ? asciiRes.some(re => re.test(hay)) || /[\u4e00-\u9fa5]/.test(q)
            : asciiRes.every(re => re.test(hay));
          if (!anyMatch) continue;
        }
        const normTitle = String(r.title || '').trim().toLowerCase().replace(/\s+/g, ' ');
        const dedupeKey = `${String(r.company || '').trim().toLowerCase()}|${normTitle}|${r.recruit_type || ''}`;
        if (seenKeys.has(dedupeKey)) continue;
        seenKeys.add(dedupeKey);
        rows.push(r);
        if (rows.length >= limit) break;
      }

      const items = rows.map(r => {
        let cities = ['全国'];
        try {
          const parsed = JSON.parse(r.cities || '[]');
          if (Array.isArray(parsed) && parsed.length) cities = parsed.slice(0, 6);
        } catch {}
        const hasFullJd = Boolean(r.description || r.requirements);
        const jdText = hasFullJd
          ? [r.description, r.requirements ? `【任职要求】\n${r.requirements}` : ''].filter(Boolean).join('\n\n')
          : `${r.company} ${r.batch || '校园招聘'}岗位：${r.title}。${r.department ? `所属部门：${r.department}。` : ''}${r.degree_min ? `学历要求：${r.degree_min}及以上。` : ''}${r.grad_year ? `面向 ${r.grad_year} 届毕业生。` : ''}投递前请点击官网原链接查看完整职责说明。`;
        const hash8 = createHash('sha1').update(String(r.wh_id)).digest('hex').slice(0, 10);
        const degMap = { '大专': 'associate', '本科': 'bachelor', '硕士': 'master', '博士': 'phd' };
        const posting = buildNormalizedPosting({
          id: `whq_${hash8}`,
          title: r.title,
          org: r.company,
          category: r.category || '技术',
          subCategory: r.subcategory || r.batch || '校招',
          jobType: r.recruit_type,
          locations: cities,
          jdText,
          hardGate: {
            graduationYears: r.grad_year ? [Number(r.grad_year)] : [],
            minDegree: degMap[r.degree_min] || null,
          },
          postUrl: r.url,
          sourceName: `${r.company}全量校招仓 (${r.source_id})`,
          sourceId: `src_wh_${String(r.source_id).replace(/[^a-z0-9_-]/gi, '_')}`,
          publishDate: r.publish_at ? String(r.publish_at).slice(0, 10) : null,
          via: hasFullJd ? 'warehouse_sqlite_jd' : 'warehouse_sqlite_meta',
        }, engine);
        return { ...posting, metadataOnly: !hasFullJd };
      });

      send(200, {
        ok: true,
        mode: 'sqlite_318k',
        totalWarehouseJobs: totalOpen,
        matchedCount,
        items,
      });
      return true;
    }

    if (pathname === '/api/employment/calendar') {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        send(405, { error: 'GET_REQUIRED' });
        return true;
      }
      const url = new URL(request.url, 'http://127.0.0.1');
      const q = (url.searchParams.get('q') || '').trim().toLowerCase();
      const sector = (url.searchParams.get('sector') || '').trim();
      const projectType = (url.searchParams.get('projectType') || '').trim();
      const gradYear = url.searchParams.get('gradYear') ? Number(url.searchParams.get('gradYear')) : null;
      const limit = Math.min(120, Math.max(1, Number(url.searchParams.get('limit')) || 60));

      const cdb = getCalDb();
      let entries = data.campusCalendar || [];
      let totalEntries = entries.length;
      if (cdb) {
        try {
          totalEntries = cdb.prepare('SELECT COUNT(*) c FROM entry').get().c;
          const rows = cdb.prepare(`
            SELECT e.id, e.group_name, e.company, e.project_type, e.grad_year, e.tracks,
                   e.apply_start, e.apply_end, e.cities, e.apply_url, e.source_url,
                   e.open_jobs, e.as_of, e.notes, t.sector AS sector
            FROM entry e
            LEFT JOIN target t ON e.group_name = t.name
            LEFT JOIN link_check l ON COALESCE(e.apply_url, e.source_url) = l.url
            WHERE (e.apply_url LIKE 'https://%' OR e.apply_url LIKE 'http://%' OR e.source_url LIKE 'https://%')
              AND (l.http_status = 200 OR e.origin = 'manual')
              AND COALESCE(e.company, e.group_name, '') NOT IN ('我爱我家','来伊份','星巴克','喜茶','茶颜悦色','蜜雪冰城','百胜中国')
            ORDER BY (CASE WHEN e.project_type IN ('校招','秋招正式批','提前批','暑期实习','春招') THEN 1 ELSE 0 END) DESC,
                     (CASE WHEN e.grad_year IN (2027, 2028) THEN 1 ELSE 0 END) DESC,
                     COALESCE(e.open_jobs, 0) DESC,
                     (CASE WHEN e.apply_end IS NOT NULL THEN 1 ELSE 0 END) DESC,
                     e.as_of DESC
            LIMIT 600
          `).all();
          const seenComp = new Set();
          entries = rows.map(r => {
            let tracks = [];
            try { tracks = JSON.parse(r.tracks || '[]').map(x => typeof x === 'string' ? x : x?.direction).filter(Boolean); } catch {}
            let cities = [];
            try { cities = JSON.parse(r.cities || '[]').filter(Boolean).slice(0, 8); } catch {}
            return {
              id: r.id,
              company: r.company || r.group_name,
              sector: r.sector || null,
              projectType: r.project_type,
              gradYear: r.grad_year ? Number(r.grad_year) : null,
              tracks: [...new Set(tracks)],
              applyStart: r.apply_start || null,
              applyEnd: r.apply_end || null,
              cities,
              applyUrl: r.apply_url && /^https?:\/\//i.test(r.apply_url) ? r.apply_url : r.source_url,
              sourceUrl: r.source_url || null,
              openJobs: r.open_jobs != null ? Number(r.open_jobs) : null,
              asOf: r.as_of || null,
              notes: r.notes || null,
            };
          }).filter(e => {
            if (!e.applyUrl || seenComp.has(e.company)) return false;
            seenComp.add(e.company);
            return true;
          });
        } catch {}
      }

      const filtered = entries.filter(e => {
        if (sector && (!e.sector || !e.sector.includes(sector))) return false;
        if (projectType && e.projectType !== projectType) return false;
        if (gradYear && e.gradYear && e.gradYear !== gradYear) return false;
        if (q) {
          const hay = `${e.company} ${e.sector || ''} ${e.projectType} ${(e.tracks || []).join(' ')} ${(e.cities || []).join(' ')}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      });
      const sectors = [...new Set(entries.map(e => e.sector).filter(Boolean))];
      send(200, {
        ok: true,
        totalEntries,
        matchedCount: filtered.length,
        sectors,
        items: filtered.slice(0, limit),
      });
      return true;
    }

    return false;
  };
}
