# Course Compass · 大学航线

## 产品主流程规范（v2.2 商业规范版 · 十步闭环架构）

核心运行原则：**事实只录入一次，下游自动继承；AI 只提供建议草稿，经用户确认后才写入档案**。

1. **阶段一：建立可信的个人事实档案（01 → 05 + 完整度网关）**
   - **01 航线首页**：新用户选择「新建个人事实档案」、「导入简历提取草稿」或「无简历用课程/课设起步」；老用户一键「继续上次进度」，并可选用本机 `AES-GCM` 256 位加密账号隔离存储。
   - **02 建立基础档案**：采集学校、年级、修读专业（核心必填项），以及预计毕业年月、学历、均分、专业排名（可稍后补充项）。
   - **03 选择专业与课程**：先确认修读专业，再通过培养方案导入（PDF / DOCX / CSV / TXT / MD）、专业公开方案推荐或手动添加录入课程，支持来源版本记录、重复核对与逐门切换「已通过 / 在修 / 未通过」状态。
   - **04 经历工坊（识别、包装、入库）**：按「① 粘贴原始经历或上传材料 → ② 建议经历类型与适用方向 → ③ 生成『角色 + 动作 + 成果』包装草稿 → ④ 编辑区核对修改并补证据保存」四步推进；未确认前绝不自动写入个人档案。
   - **05 时间与成果补充（三项并行补充）**：**05a 加入时间**（课程、考试、实习及其他固定日程的起止日期与占用时段）、**05b 可投入时间**（每周可自由支配小时数、可用时段与可实习窗口）、**05c 已有成果**（自动同步 04 经历工坊成果，仅需补录遗漏项并核验真实性与量化指标）。
   - **流转网关 · 档案完整度检查**：检查通过直接进入阶段二；缺失项精准定位并支持一键退回对应步骤补全，非关键项可显式标记「稍后补充」后放行。
2. **阶段二：确认能力档案，而非仓促定稿最终简历（06）**
   - **06 生成档案预览**：默认展示「结构化能力档案」（集中呈现学籍背景、专业课程矩阵、经历成果、客观派生技能图谱、时间约束及待核验/稍后补充清单），支持切换「基础简历视图」核查表述密度；经本人确认后生成不可变版本快照（支持多版本回看与 JSON 导出/导入恢复）。
3. **阶段三：形成方向、诊断与岗位目标（07 → 09）**
   - **07 路径选择与优先级**：在「保研 / 考研 / 留学 / 就业」中支持多选，并强制设定唯一**主路径（★ P1）与优先级顺序**，避免多路径均摊失焦。
   - **08 专属诊断与全局行动计划**：结合已确认档案与路径优先级，输出各路径门槛、资格状态、技能差距、关键时间窗口及全局统一行动清单；支持随时无损返回调整路径或补充档案。
   - **09 就业·岗位库**：先选职业方向与岗位族，支持无简历同学以专业课与课程设计（课设）冷启动匹配；当收藏或设为目标岗位时，系统自动反推技能缺口、四步自学路线与投递节点，并**实时回写至全局行动计划**。
4. **全局联动输出与实时重算机制（10 + 辅助模块）**
   - **10 时间冲突海图（最后实时生成）**：动态合并 05a 固定日程、05b 每周可投入负荷预算、07/08 路径关键节点与切换窗口、以及 09 目标岗位的投递窗口与学习任务工时；信息不足处诚实声明边界，绝不生成伪精确结论。
   - **实时更新规则**：任一上游事实变更时，完整保留原始记录并自动重算下游诊断、岗位匹配与冲突海图，无需重复填写。
   - **辅助模块（不阻塞主流程）**：「定向情报」作为路径确认后的辅助订阅流，「引擎与技术」作为底层架构说明独立展示。

---

## 就业·岗位库（双擎架构 · 离线简历解析 · 四步精简成长路线 · 静态 + 本地双模运行）

支持两种零成本打开方式：
1. **在线静态网站版（免安装即开即用）**：直接浏览器访问 [https://xxr627.github.io/course-compass/](https://xxr627.github.io/course-compass/)。自动激活纯前端八维引擎 + `expert-copilot-v2` 专家副驾 + 浏览器端离线 PDF/DOCX 简历解析（亦可在「☁️ 云端 API 配置」填入个人免费魔搭/硅基流动/智谱会话 Key 直连大模型）。
2. **本机全量引擎版（含 31.8 万 SQLite 校招仓 + `.env.local` 多源免费云网关）**：Windows 下双击运行 **`start.bat`**（自动识别便携版 Node 路径并打开 `http://127.0.0.1:8090/`），或在终端运行 `node _serve.mjs`（部署至 **Qoder Sites** 或公网容器时可执行 `HOST=0.0.0.0 PORT=8090 node _serve.mjs`）。服务端内置同源、`127.0.0.1` 与 `X-Forwarded-Host` 安全校验及请求限流保护。**默认严格零本地 GPU 占用**：绝不自动探测或拉起本机 Ollama / 千问权重（避免抢占宿主机训练显存）；仅当显式设置 `CC_ENABLE_LOCAL_LLM=1` 时才启用本地 Ollama。

云端内置 **多源纯免费 OpenAI 兼容瀑布流网关（零付费扣费风险）**：支持在 `.gitignore` 忽略的 `.env.local`、页面「☁️ 云端 API 配置」弹窗一键挂载或通过 `node _setup-modelscope.mjs <Token>` 配置 **`MODELSCOPE_API_KEY`（方案一 · 魔搭 API-Inference 每日免费额度，超额仅返 `429` 绝不自动扣费；内置 7 款实测纯免费模型：`Qwen/Qwen3.8-27B` 首选、`Qwen/Qwen3.8-Flash-Next`、`deepseek-ai/DeepSeek-V4.1-Flash-1017`、`Qwen/Qwen3.5-122B-A10B`、`Qwen/Qwen3.5-397B-A17B`、`deepseek-ai/DeepSeek-V4-Pro-0813`、`Qwen/Qwen3.5-35B-A3B`）→ `SILICONFLOW_API_KEY`（硅基流动永久免费 `Qwen/Qwen3-8B` / `GLM-4-9B`）→ `ZHIPU_API_KEY`（智谱永久免费 `glm-4.7-flash` / `glm-4.5-flash` / `glm-4-flash-250414` 跨平台二顺位自动兜底）→ `DASHSCOPE_API_KEY` / `QIANFAN_API_KEY` → `expert-copilot-v2`（零显存规则兜底）**。网关自动执行 **`3.5s` 首字超时截断（TTFT Guard）+ `120s` 拥塞冷却熔断 + `401/403/429` 跨平台无缝回退 + `enable_thinking: false` / `<think>` 流式净滤 + `30min` 内容哈希内存缓存（秒回 `1ms`）**。

### 核心架构亮点

- **第一层 · 八维结构化字段对表（`match-2.0.0`，确定性毫秒级）**：对全量岗位逐项核对「学历门槛、类型与届别、方向与专业、城市与办公、核心硬技能（`TAXONOMY_VERSION = '2026.11.3'`，83 项结构化技能，与通用软技能分层）、成果与作品、排期与投入（含暑期/秋季实习排期冲突检测）、薪资与福利」。权重分配：`skills: 0.40`、`project: 0.26`、`internship: 0.10`、`direction: 0.08`、`location: 0.06`、`jobType: 0.04`、`salary: 0.02`、`portfolio: 0.04`，由确定性规则锁定资格三态、匹配指数、真实薪资折算（日薪按 `21.75 × 日薪`、年薪按 `年薪 ÷ 12` 统一月薪比较口径）与 JD 原文引文，杜绝幻觉。
- **第二层 · 全五景流式 AI 副驾 + 零显存专家兜底**：全量打通 `/match-copilot`（一岗一策诊断 + `.md` 冲刺单一键导出）、`/parse-jd`（JD 语义拆解）、`/compare-jobs`（多岗对比参谋）、`/growth-plan`（「我的成长路线 · AI 两周自研导师」）、`/evidence-analyze`（「作品与经历工坊」，前后端双层 PII 隐私脱敏）及 `/employment/roadmaps/research` 联网规划智能总结。前端「☁️ 多源免费云端大模型网关」弹窗提供五大平台一键预设及实时熔断/缓存监控。
- **直连全网公开校招 API + 31.8 万仓 + 5,611 条名企校招日历（已彻底移除 Boss直聘 / 手动粘贴 JD 入口）**：
  - **实时官网 ATS 直连**：`_employment-live-api.mjs` 直采腾讯校招（`join.qq.com`）、SmartRecruiters（`BoschGroup`、`Continental`）及 Greenhouse（`cloudflare`、`airbnb`），一键合并入库并持久化至浏览器 `state.jobs.liveJobs`。
  - **318,433 岗位 SQLite 仓储检索 & 5,611 条校招日历**：接入本地 `_research/jobs.db` 实时检索与 `_research/calendar.db` 名企秋招/提前批/暑期实习日历，支持网申窗口、截止时间、在招规模与官网直投入口筛选（自动过滤无关零售门店/中介经纪并按企业去重）。
  - **精选内嵌商业快照（682 条真实岗位 + 8 项竞赛 = 690 条需求）**：覆盖 160 条真实明确薪资、257 条届别、567 条学历、489 条行业归属及 180 条精选校招日历，支撑 4,744 条 JD 原文依据与 2,595 条结构化技能需求。
- **经历证据单调分层 + B站/开源自研主线 + 冷启动低权兜底**：
  - **真实经历远高于课设**：证据权重严格遵循 `internship > project > competition > research > other > coursework > courseOnly`。未验证的课程作业保留为 `learned_unverified`，不会虚高覆盖分。
  - **自学与自研主线（`SELF_STUDY_CATALOG`）**：成长路线优先推荐 B 站体系课、官方文档、GitHub 可开源实战蓝图与竞赛切入点，彻底聚焦「自学—自研—打比赛—真实交付物」。
  - **条件式冷启动兜底**：仅当学生档案尚无任何实习、自研项目、竞赛或科研经历（`!CC.hasHardcoreExperience(cp)`）时，才展示「零实战冷启动过渡：低权重课设工程化改造（兜底策略）」，引导先改造 1 份课设作敲门砖，同时主线跟进自研项目；一旦具备硬核经历则自动收起。
- **可追溯可视化与商业投递闭环**：
  - **SVG 三栏溯源图谱**：岗位详情直观渲染 `我的实战/经历证据 → 岗位核心硬技能三态 → JD 原文依据条文` 三栏连线图谱，硬核实证、低权课设与急需缺口一图清晰。
  - **A4 定制定向简历工坊 & 导出**：支持按目标岗位实时重排 STAR 要点、缺失指标标出 `[待补充实测数据]`，提供 Markdown 下载与浏览器 A4 打印排版（`@media print`）。
  - **五阶段投递看板与面试复盘**：提供五阶段状态流转看板，并支持录入高频追问生成专项加练动作与能力映射。

## 更新与构建快照

`index.html` 是浏览器主入口，`_cc-data.json` 与 `_cc-engine.js`（`MATCH_VERSION = 'match-2.0.0'` / `TAXONOMY_VERSION = '2026.11.3'`）是内嵌构建来源。更新仓内抽样数据或修改引擎/UI 后，按顺序执行：

```sh
node _enrich-catalog.mjs
node _build-inline.mjs
node _build-inline.mjs --check
```

## 接口与自动检查

### 本地 / Qoder Sites 服务与接口

运行 `node _serve.mjs` 后，除前端页面外，同源提供以下 API：
- `POST /api/register`、`POST /api/login`、`GET /api/session`、`POST /api/logout`、`POST /api/profile/delete`：本机回环地址专属的学生账号加密身份服务（SQLite + `scrypt` 密码校验 + Web Crypto `AES-GCM` 浏览器端加密保险箱 + Web Locks 防多标签冲突 + 删档轮换密钥且保持原账号登录）。
- `GET /api/employment/live-sync`：实时拉取腾讯 / SmartRecruiters / Greenhouse 公开岗位。
- `GET /api/employment/warehouse`：检索本地 `318,433` 条 SQLite 招聘仓（支持关键词、城市、岗位类型、薪资筛选）。
- `GET /api/employment/calendar`：检索 `5,611` 条校招日历及官网直投入口（按企业去重与批次排序）。
- `POST /api/employment/llm/*`：零本地显存 `expert-copilot-v2` 或远程 Cloud OpenAI-Compatible API 诊断。
- `GET /employment/jobs`、`GET /employment/jobs/{jobId}`、`POST /employment/matches/query`：只读公开快照与去标识画像服务端对表契约（见 `employment.schema.json`）。

### 全量自动检查（Node.js >= 22.5.0）

运行环境需 Node.js `>= 22.5.0`（使用内置 `node:sqlite`）及 Playwright / Chromium（或通过 `CC_BROWSER_PATH` 指定本机 Edge 路径）。日常回归默认 Zero-GPU 模式（不设置 `CC_ENABLE_LOCAL_LLM`）：

```sh
node _smoke.mjs
node _employment-contract-test.mjs
node _employment-eval.mjs --self-test
node _build-inline.mjs --check
node _employment-e2e.mjs
```

`employment.schema.json` 定义岗位、来源快照、结构化技能条目、就业画像、校招日历与匹配结果的 JSON 契约。运行浏览器测试可使用系统已安装的 Edge（设置 `CC_BROWSER_PATH`）。

### 试用评测

每批试用开始前保留当时的 `_cc-data.json` 和配套评测代码版本，后续以同一套快照、匹配规则和岗位族词表汇总问卷与标注。首轮目标是 20–30 名真实学生。请试用者用现有档案选择方向、核对前五个推荐、查看至少一个岗位的原文和成长任务，再提交试用问卷。正式排名评测另按 100 个完整标注案例统计。

使用本人档案时，岗位详情的「试用反馈」可记录匹配理由是否有帮助、岗位是否符合求职方向。「就业偏好与简历经历导入 → 试用评测」可下载包含去标识特征和最多 40 条待标注岗位的 JSON。演示档案不开放试用样本导出。样本保存在本机，由导出者选择如何共享。同一浏览器档案重复导出的样本使用同一个随机案例编号。

「打开试用问卷」可记录职业方向是否有用、对匹配指数的理解、推荐理由能否查证及成长任务能否执行，并逐条评价试用开始时的前五个推荐。可跳过任何题目。运行下列命令汇总问卷，同一案例只计入最近一次导出。报告分别显示各题回答人数、选项分布和比例，跳过的题目不进入分母。

```sh
node _employment-eval.mjs --catalog pinned-catalog.json --pilot review-01.json review-02.json
```

评审可在文件的 `labels` 中为对应岗位 ID 写入相关性 `grade`（0 明显不相关、1 可探索、2 值得投、3 高优先级）。审核解释时可填写 `explanationMatches`。候选列表没有预填评分和排名。原始岗位快照可随试用批次留档，更新后的快照与原批次不一致时通过 `--catalog` 指定原文件。

评审也可用离线标注页。用试用时冻结的岗位快照生成页面，打开生成的 HTML 可查阅去标识画像和候选岗位原文。先独立判相关性，再按需展开重算的推荐理由。标注未完成时可下载结果，下次打开同一个评审页面时可导入继续。提交该批次的最新一份标注即可。合并时会核对版本、案例编号和候选岗位，已评分岗位的冲突需要人工核对。

```sh
node _employment-annotate.mjs prepare pinned-catalog.json reviewer.html review-01.json review-02.json
node _employment-annotate.mjs attach pinned-catalog.json graded.ndjson review-01.json review-02.json --labels course-compass-expert-labels.json
node _employment-eval.mjs --catalog pinned-catalog.json graded.ndjson
```

```sh
node _employment-eval.mjs --catalog pinned-catalog.json review-01.json review-02.json
```

评测输出 NDCG、Precision、Recall、岗位与方向覆盖率以及资格未知率。排名指标按已标注岗位计算，部分标注案例的指标可用于预查，报告同时列出完整评测案例数。解释实用度和学生的方向反馈单独报告。

### 离线权重校准

校准使用同一份岗位快照下的两组独立参与者。校准会核对随机案例编号以及岗位、算法、岗位族版本，防止同一个案例同时出现在两组。一个批次确定后，请沿用同一批样本和分组进行复核。

`node _employment-eval.mjs --catalog pinned-catalog.json --cohort graded.ndjson` 可审查标注进度。百人规模目标和建议分组只计入至少有 30 个候选且全部评完的案例，不足或尚未完成的案例仍显示在覆盖统计中。建议分组按快照和案例编号计算，可复现。

```sh
node _employment-eval.mjs --catalog pinned-catalog.json --calibrate graded.ndjson
node _employment-eval.mjs --catalog pinned-catalog.json --calibrate train-01.json train-02.json --validation heldout-01.json heldout-02.json
```

第一条命令从整批标注直接按 `--cohort` 的分组计算，只使用完整案例。第二条命令适用于已有训练集和留出组的批次。

候选权重在有变化的已知因子之间移动 2 或 4 个百分点。训练集先比较专家标注的 NDCG@5 和 Precision@5，再用有明确方向反馈的岗位打破平手。评测投影不含城市、薪资偏好或作品链接，这些因子沿用现行权重。报告保留两组成员、权重和指标差异。达到百人完整评测规模，且留出组的前五名指标有改善、其他排名指标及可计算的学生方向反馈指标没有下降时，报告会将候选权重标记为可人工复核。单次命令只生成报告，线上权重由人工评审决定。真实试用、专家标注和评分校准需要实际参与者数据。

JD 解析验证可用 `node _employment-jd-model.mjs --benchmark jd-review.json`。输入包含 `taxonomyVersion` 和 `cases`，每条记录提供 `jobId`、`jdHash`，以及人工检查后的 `requirements`（`skillId`、`importance`、`textSpan`）。命令校验原文版本和引用片段，分别报告纯规则与当前快照中已存模型标注的技能识别及必需／加分分类 Precision、Recall，并列出模型实际覆盖的 JD 数量。

[现状评估](EMPLOYMENT_MODULE_STATUS.md) 记录最新商业化升级实测基线。[定向情报技术说明](TECH.md) 记录共用档案与定向情报的原型设计。
