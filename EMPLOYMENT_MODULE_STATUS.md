# Course Compass｜就业·岗位库商业化升级验收报告（v2.0）

更新日期：**2026-11-20**（面向 **2026 Qoder 高校创造力大赛** 商业化上市交付版本）。本报告记录最新重构与全量实测验收结果。

## 1. 版本升级总览

| 维度 | 升级前原型（2026-11-19 基线） | 升级后商业版（2026-11-20 实测） |
| --- | --- | --- |
| 内联引擎与浏览器渲染 | HTML 内嵌引擎滞后，`ccJobCard()` 抛异常阻塞 | `_cc-engine.js` (`match-2.0.0`, taxonomy `2026.11.3`) 与 `index.html` 完全同步，零控制台报错 |
| 外部/Boss直聘手动粘贴 | 存在手动粘贴外部 JD 表单，体验割裂 | **彻底移除** `#cc-import-form` 与导入按钮，历史 `importedJobs` 启动自动清理 |
| 全网 API 与公开数据规模 | 单一企业 79 条样本，薪资与门槛全空 | **682 条精选岗位 + 8 项竞赛 = 690 需求**；**160 条真实薪资**、257 条届别、567 条学历、489 条行业、**180 条精选校招日历**；直连 **腾讯 / SmartRecruiters / Greenhouse** 实时 API + **318,433 条 SQLite 招聘仓** + **5,611 条校招日历** |
| 经历与课设权重体系 | 普通成果/作业虚高进入 `evidenced` | **严格单调权重**：`internship > project > competition > research > other > coursework > courseOnly`；未核验课设停留 `learned_unverified` |
| 成长主线与冷启动策略 | 作业升级为核心入口，缺少自学闭环 | 主推 **B 站体系课 + 官方文档 + GitHub 可开源项目 + 学科竞赛**；仅无硬核经历档案条件展示「低权重课设工程化冷启动兜底」 |
| AI 副驾与 GPU 安全 | 启动默认探测本机 Ollama，易爆显存 | **默认零本地 GPU 占用**：`expert-copilot-v2` 毫秒级专家副驾 + 可选远程 Cloud OpenAI-Compatible API（`sessionStorage`）；仅 `CC_ENABLE_LOCAL_LLM=1` 显式开启本地 Ollama |
| 公网部署安全（Qoder Sites） | 仅纯静态或本机 HTTP 无来源保护 | `_serve.mjs` 支持 `HOST=0.0.0.0 PORT=8090`，校验 `Origin` / `Referer` / `X-Forwarded-Host`（跨域返回 `403`）与 API 限流，免登录即开即用 |

## 2. 核心工程模块与数据口径

### 2.1 八维确定性匹配算法（[`_cc-engine.js`](_cc-engine.js)）

- **算法版本与词表**：`MATCH_VERSION = 'match-2.0.0'`、`TAXONOMY_VERSION = '2026.11.3'`，新增 11 项工业级硬技能（`golang`、`cpp_modern`、`redis`、`mq_kafka`、`cloud_k8s`、`computer_vision`、`ros_slam`、`fpga_verilog`、`ai_agent_workflow`、`sql_bi`、`growth_ops`），结构化技能词典共 **83 项**。
- **权重配比**：`skills: 0.40`、`project: 0.26`、`internship: 0.10`、`direction: 0.08`、`location: 0.06`、`jobType: 0.04`、`salary: 0.02`、`portfolio: 0.04`。
- **关键机制**：
  - 同一岗位下仅变更单一经历类型时的严格单调性已通过单测验证：`internship (39) > project (34) > competition (33) > coursework (22) > courseOnly (17)`。
  - 空画像防护（`matchScore === null`）、14 天/21 天快照新鲜度衰减标记、暑期/秋季实习排期冲突检测、硬门槛对象化 `extractHardGateObject`，以及前后端一致的去标识投影 `projectEmploymentMatchProfile`。

### 2.2 全网实时 API、31.8 万仓与 5,611 条校招日历（[`_employment-live-api.mjs`](_employment-live-api.mjs) & [`_enrich-catalog.mjs`](_enrich-catalog.mjs)）

- **全网 ATS 直连**：支持实时抓取腾讯招聘（`join.qq.com`）、SmartRecruiters（`BoschGroup`、`Continental`）与 Greenhouse（`cloudflare`、`airbnb`），增量合入 `state.jobs.liveJobs` 参与实时筛选与匹配。
- **318,433 岗位仓储接口**：`/api/employment/warehouse` 直连 `_research/jobs.db`（318,433 条原始记录），支持关键词、城市、岗位类型与薪资快速检索。
- **5,611 条校招日历**：`/api/employment/calendar` 连通 `_research/calendar.db`（5,611 条校招日历动态），与内置 180 条精选日历统一执行零售连锁/房产中介降噪过滤、同企业去重及「校招/秋招正式批/提前批/暑期实习/春招」优先排序。

### 2.3 多源纯免费云端智能熔断网关与商业化界面（[`_employment-llm.mjs`](_employment-llm.mjs) & [`index.html`](index.html)）

- **方案一（魔搭 ModelScope）主挂载 + 智谱跨平台二顺位兜底 + 零付费保证**：
  - 主引擎已打通 **魔搭社区 API-Inference**（`https://api-inference.modelscope.cn/v1`，每日免费推理额度，超额仅返 `429` 绝不自动扣费），默认主力模型为实测速度与质量双优的 **`Qwen/Qwen3.8-27B`**，顶部下拉框支持实时切换 11 款零显存引擎（7 款魔搭实测纯免费模型：`Qwen/Qwen3.8-27B`、`Qwen/Qwen3.8-Flash-Next`、`deepseek-ai/DeepSeek-V4.1-Flash-1017`、`Qwen/Qwen3.5-122B-A10B`、`Qwen/Qwen3.5-397B-A17B`、`deepseek-ai/DeepSeek-V4-Pro-0813`、`Qwen/Qwen3.5-35B-A3B` + 3 款智谱永久免费 Flash 模型 + `expert-copilot-v2`）。
  - 保留 `.env.local` 中的智谱永久免费池（`glm-4.7-flash` / `glm-4.5-flash` / `glm-4-flash-250414`）作为第二顺位跨平台自动容灾，并支持硅基流动、阿里云百炼与百度千帆；同时提供 `node _setup-modelscope.mjs <Token>` 一键校验写入脚本与页面弹窗一键挂载接口（`POST /api/employment/llm/configure-provider`，仅限本机回环访问）。
  - 流式请求默认下发 `enable_thinking: false`（魔搭）/ `thinking: { type: 'disabled' }`（智谱）并叠加流式 `<think>` 净滤器，配合 **`3.5s` 首字超时熔断（TTFT Guard）+ `120s` 冷却熔断器（`modelHealthMap`）+ `401/403/429` 跨平台无缝切换 + `30min` SHA-256 内存 LRU 缓存（`1ms` 秒回，点「重新生成」带 `forceRefresh: true` 穿透刷新）**。
- **商业化界面体验**：
  - **五大 AI 场景全覆盖**：一岗一策深度副驾（支持 `.md` 冲刺单一键下载）、JD 深度语义拆解、选岗对比参谋、我的成长路线「AI 两周自研导师」（`/api/employment/llm/growth-plan`）、作品与经历工坊（前后端双层 PII 隐私脱敏 `ccMaskClientPii`，杜绝截图泄密）。
  - **多源免费模型网关弹窗**：内置绿色「🥇 方案一 · 一键打通魔搭 ModelScope」卡片（含 `✓ 已打通生效` 状态标）、五大平台一键预设，以及实时 EWMA 首字耗时 / 熔断冷却 / 缓存命中可视化监控。
  - **体验区全能控制台、SVG 三栏溯源图谱、A4 定向简历打印与五阶段投递看板**全链路闭环。

## 3. 自动化与视觉验收记录（2026-11-22 最新通过）

### 3.1 五大自动化测试套件（全部 Exit Code `0`）

执行环境：Node.js `v22.23.5`（Zero-GPU 默认模式，未设置 `CC_ENABLE_LOCAL_LLM`），`CC_BROWSER_PATH` 指向本机 Microsoft Edge：

| 检查项 | 执行命令 | 实测结果 |
| --- | --- | --- |
| 引擎与熔断规则冒烟测试 | `node _smoke.mjs` | 通过（`SMOKE_OK`，覆盖 690 条需求、Java≠JS、单调性、`3.5s` TTFT 熔断与 `120s` 冷却跳过、`<think>` 流式过滤及魔搭→智谱跨平台回退单测） |
| JSON Schema 数据契约校验 | `node _employment-contract-test.mjs` | 通过（校验 **682 条公开岗位、6 份测试画像、4,152 条匹配结果、2,595 条技能需求、4,744 条 JD 原文事实**） |
| 评测与校准逻辑自检 | `node _employment-eval.mjs --self-test` | 通过（`Employment metric checks passed`） |
| HTML 内联包一致性校验 | `node _build-inline.mjs --check` | 通过（`Employment bundle ready: 682 job records`） |
| 无头浏览器端到端全流程 | `node _employment-e2e.mjs` | 通过（`Employment browser checks passed`） |

### 3.2 方案一（魔搭 ModelScope）线上真机六场景实测与视觉审计

通过 Playwright 无头浏览器直连本机 `node _serve.mjs` 与魔搭线上纯免费 API 实测确认（`MODELSCOPE_LIVE_ALL_PASS`，`errors: []`，零控制台报错、零本地显存占用）：

| 产品场景 | 实测生效引擎 | 服务端首字 TTFT | 服务端总耗时 | 验收要点 |
| --- | --- | --- | --- | --- |
| 一岗一策深度副驾 | `Qwen/Qwen3.8-27B` | **`0.52s`** | **`7.70s`** | 四栏卡片完整、忠实标注 `[待补充实测数据]`、支持 `.md` 导出 |
| 同岗位副驾复访（LRU 缓存） | 30 分钟内存缓存 | — | **`1ms`** | 页面标注 `⚡ 缓存秒回`，零上游消耗 |
| JD 深度语义拆解 | `Qwen/Qwen3.8-27B` | **`0.38s`** | **`2.27s`** | 严格依据岗位原文提炼硬门槛/加分亮点/注意事项 |
| 选岗对比参谋 | `Qwen/Qwen3.8-27B` | **`0.43s`** | **`2.82s`** | 多岗维度对比清晰、首字亚秒级响应 |
| 成长路线 · 两周自研导师 | `Qwen/Qwen3.8-Flash-Next`（下拉热切换） | **`0.45s`** | **`4.87s`** | 含核心机理拆解、两周独立自研日程与作品集验收标准 |
| 作品与经历工坊（PII 脱敏） | `Qwen/Qwen3.8-Flash-Next` | **`0.78s`** | **`3.86s`** | 前端展示卡片与模型回复双层脱敏为 `[已脱敏]` |
| 多源免费网关弹窗状态 | 魔搭 + 智谱双池在线 | EWMA `0.46s` / `0.45s` | — | 绿标 `✓ 已打通生效`，11 款零显存引擎即选即切，`.env.local` 受 `.gitignore` 严格忽略 |
