import { callCloudChat, fetchModelScopeLiveModels, upsertLocalEnvVars } from './_employment-llm.mjs';

const args = process.argv.slice(2).filter(Boolean);
const token = (args[0] || process.env.MODELSCOPE_API_KEY || process.env.MODELSCOPE_SDK_TOKEN || '').trim();
const preferredModel = (args[1] || 'Qwen/Qwen3.8-27B').trim();

if (!token) {
  const liveModels = await fetchModelScopeLiveModels();
  console.log('=== 方案一 · 魔搭社区 ModelScope 一键挂载向导 ===');
  console.log('1. 打开 https://modelscope.cn/my/myaccesstoken （绑定阿里云实名后每日约 2,000 次免费调用）');
  console.log('2. 复制 Access Token（ms-... 开头）后执行：');
  console.log('   node _setup-modelscope.mjs <你的Access-Token> [可选模型ID]');
  console.log('3. 当前魔搭在线可用主力模型（前 8 项）：');
  liveModels.slice(0, 8).forEach(id => console.log('   -', id));
  process.exit(0);
}

console.log(`正在验证魔搭 Token 与模型「${preferredModel}」连通性…`);
try {
  const res = await callCloudChat({
    cloudConfig: {
      apiKey: token,
      baseUrl: 'https://api-inference.modelscope.cn/v1',
      model: preferredModel,
    },
    providers: [],
    system: '用15字以内回答你是谁',
    userContent: '你好',
    stream: false,
    maxTokens: 40,
    timeoutMs: 15000,
  });
  upsertLocalEnvVars({
    MODELSCOPE_API_KEY: token,
    MODELSCOPE_MODEL: res.model,
  });
  console.log('✓ 魔搭方案一验证通过并已写入 .env.local（已受 .gitignore 保护，智谱自动保留为第二顺位保底）！');
  console.log({ activeModel: res.model, latencyMs: res.latencyMs, reply: res.content });
} catch (error) {
  console.error('✗ 魔搭验证未通过：请确认已在 modelscope.cn 绑定阿里云实名并复制正确的 Access Token。', error.message);
  process.exit(1);
}
