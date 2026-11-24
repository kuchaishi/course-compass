# 来源提取：用户提供的腾讯文档《27届校招秋招实习内推合集》

- URL: https://docs.qq.com/smartsheet/DY3pHYkNvb0ZRSHdi?tab=BB08J2
- 访问日期: 2026-11-19（guest 可读，canRead:true）
- 提取方式: browser-use 渲染 → 钩子捕获 websocket/opendoc 载荷 → zlib(base64 `eJz…`) DecompressionStream('deflate') 解压 → 解析单元格 JSON
- 性质: 众包内推合集（含个人内推码/分享参数），trustTier B_EXPERIENCE；各公司官网入口本身为 A_OFFICIAL。
- 处理: 去除 recommendCode/shareId/token/qrCode 等内推与分享参数，仅保留官方招聘入口根域名/稳定路径。

## 已捕获 tab
- BB08J2 实习内推汇总（112 行，互联网/消费科技/外企）
- tKM95t 官方招聘平台汇总（国企/央企/银行/能源/制造/政府平台）
- t8SU2G 互联网&AI类（大厂官网根域名）

## 其他未展开 tab（备查）
t0gmEC 秋招内推汇总 / tZW9Ng 每日更新 / tSkCgD 游戏类 / tySZCN 硬件&机器人 /
tHxlVj 智驾&新能源 / ts8GZp 科技&制造业 / trE3Hz 金融&电商类 / tQy40z 教育&医疗&其他 /
tsG8L1 求职资料库 / t7vYUL 牛客面经 / tDCdQE 在职师兄师姐经验分享

##  curated 官方入口（已写入 _cc-engine.js SOURCES，category 分组）
互联网/AI: 美团 zhaopin.meituan.com · 京东 campus.jd.com · 网易 campus.163.com · 快手 campus.kuaishou.cn ·
哔哩哔哩 jobs.bilibili.com · 小红书 job.xiaohongshu.com · 蚂蚁 hrrecommend.antgroup.com · 滴滴 didiglobal(Moka) ·
科大讯飞 iflytek.zhiye.com · 拼多多 careers.pddglobalhr.com · 腾讯音乐 join.tencentmusic.com · 携程 careers.ctrip.com ·
联想 talent.lenovo.com.cn · 同花顺 campus.10jqka.com.cn · 东方财富 eastmoney(Moka) · 万得 wind.com.cn ·
360 360campus.zhiye.com · 金山WPS wps(Moka) · 得物 poizon.jobs.feishu.cn · 极兔 jtexpress.jobs.feishu.cn ·
作业帮 zuoyebang(Moka) · 货拉拉 huolalahr(Moka) · 广联达 glodon(Moka) · 合合信息 intsig.zhiye.com ·
万兴 wondersharecampus.zhiye.com · 亿联 yealink.zhiye.com · 浩鲸 iwhalecloud1.zhiye.com · 群核(酷家乐) qunhemail(Moka)
智能硬件/制造: OPPO careers.oppo.com · vivo hr-campus.vivo.com · TP-Link join.tplinkglobal.com · 海尔 maker.haier.net ·
CVTE campus.cvte.com · 安克 anker-in.jobs.feishu.cn · 博世 bosch(Moka) · SHEIN shein(Moka) · 寒武纪 cambricon(Moka) · 元戎启行 deeproute(Moka)
游戏/创意: 网易雷火 xiaozhao.leihuo.netease.com · 库洛 kurogame.jobs.feishu.cn · 灵犀互娱 go.lingxigames.com
国企/央企/金融: 国家电网 zhaopin.sgcc.com.cn · 中国移动 job.10086.cn · 中国电信 chinatelecom.com.cn/zp ·
工行 job.icbc.com.cn · 招行 career.cmbchina.com · 交行 job.bankcomm.com · 中车 crrcgc.cc · 商飞 zhaopin.comac.cc ·
东航 job.ceair.com · 南航 job.csair.cn · 国家能源 zhaopin.chnenergy.com.cn · 中核 cnnc.zhiye.com · 航天科技 casc.com.cn ·
航天科工 casic.com.cn · 中国电子 cec.hotjob.cn · 中国电科 cetc.com.cn · 三峡 ctg.cn · 中远海运 coscoshipping.com ·
宝武 campus.51job.com/baowugroup2024 · 中国建材 cnbm.com.cn · 中铝 chinalco.com.cn · 国铁 rczp.china-railway.com.cn ·
中国中铁 crecg.com · 中化 sinochem.hotjob.cn · 大唐 zhaopin.china-cdt.com · 电建 zhaopin.powerchina.cn · 九坤 ubiquantrecruit(Moka)
综合平台: 国聘 job.iguopin.com · 学信网就业 jybzp.chsi.com.cn · 前程无忧 51job.com · 人社部 job.mohrss.gov.cn