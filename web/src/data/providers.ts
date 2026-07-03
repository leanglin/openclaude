// Seeded from the Supported Providers table in the repo README.

export interface Provider {
  id: string
  name: string
  setup: string
  envVars?: string[]
  notes: string
}

export const providers: Provider[] = [
  {
    id: 'openai-compatible',
    name: 'OpenAI-compatible',
    setup: '/provider 或 env vars',
    envVars: ['OPENAI_API_KEY', 'OPENAI_BASE_URL', 'OPENAI_MODEL'],
    notes: '适用于 OpenAI、OpenRouter、DeepSeek、Groq、Mistral、LM Studio 以及任何兼容 /v1 的 server。',
  },
  {
    id: 'opengateway',
    name: 'Gitlawb Opengateway',
    setup: '启动默认值、/provider 或 env vars',
    envVars: ['OPENAI_API_KEY', 'OPENAI_MODEL'],
    notes: '智能 gateway 地址为 https://opengateway.gitlawb.com/v1。需要从 gitlawb.com/opengateway/keys 获取 API key；会按模型名路由 Xiaomi MiMo 和 GMI Cloud partner models。',
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    setup: '/provider 或 env vars',
    envVars: ['GOOGLE_API_KEY'],
    notes: '仅支持 API-key auth。',
  },
  {
    id: 'github-models',
    name: 'GitHub Models',
    setup: '/onboard-github',
    envVars: ['GITHUB_TOKEN'],
    notes: '通过交互式 onboarding 保存凭据。',
  },
  {
    id: 'codex-oauth',
    name: 'Codex OAuth',
    setup: '/provider',
    notes: '在浏览器中打开 ChatGPT 登录，并安全保存 Codex credentials。也可以复用现有 Codex CLI auth 或 env credentials。',
  },
  {
    id: 'near-ai',
    name: 'NEAR AI',
    setup: '/provider 或 env vars',
    envVars: ['NEARAI_API_KEY'],
    notes: '统一 gateway（Claude、GPT、Gemini 以及 TEE open models），地址为 https://cloud-api.near.ai/v1。',
  },
  {
    id: 'ollama',
    name: 'Ollama',
    setup: '/provider 或 env vars',
    notes: '本地推理，不需要 API key。',
  },
  {
    id: 'lm-studio',
    name: 'LM Studio',
    setup: '/provider 或 env vars',
    envVars: ['OPENAI_BASE_URL'],
    notes: '本地 OpenAI-compatible server；将 base URL 指向 LM Studio endpoint。',
  },
  {
    id: 'xiaomi-mimo',
    name: 'Xiaomi MiMo',
    setup: '/provider 或 env vars',
    envVars: ['MIMO_API_KEY'],
    notes: 'OpenAI-compatible API 地址为 https://mimo.mi.com；默认使用 mimo-v2.5-pro。',
  },
  {
    id: 'opencode-zen',
    name: 'OpenCode Zen / Go',
    setup: '/provider 或 env vars',
    envVars: ['OPENCODE_API_KEY'],
    notes: '按量付费 gateway（Zen）和 open models 订阅层（Go）；两者通过 opencode.ai 共用同一个 key。',
  },
  {
    id: 'atomic-chat',
    name: 'Atomic Chat',
    setup: '/provider 或 env vars',
    notes: '本地模型 provider，可自动检测已加载模型。',
  },
  {
    id: 'hicap',
    name: 'Hicap',
    setup: '/provider 或 OpenAI-compatible env vars',
    notes: '使用 api-key auth；从未认证的 /models endpoint 发现模型；支持 gpt- models 的 Responses mode。',
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    setup: '/login 或 env vars',
    envVars: ['ANTHROPIC_API_KEY'],
    notes: '使用 Anthropic 账号登录，或直接使用 API key。',
  },
  {
    id: 'cloud-routes',
    name: 'Bedrock / Vertex / Foundry',
    setup: 'env vars',
    notes: 'Anthropic-family cloud routes。Vertex 用于 Vertex AI 上的 Claude，不是任意 Model Garden 模型。',
  },
]
