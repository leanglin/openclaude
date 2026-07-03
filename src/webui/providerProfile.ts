import {
  DEFAULT_GEMINI_BASE_URL,
  DEFAULT_GEMINI_MODEL,
  DEFAULT_MISTRAL_BASE_URL,
  DEFAULT_MISTRAL_MODEL,
  buildGeminiProfileEnv,
  buildMistralProfileEnv,
  buildOllamaProfileEnv,
  buildOpenAIProfileEnv,
  createProfileFile,
  getDefaultProfileFilePath,
  loadProfileFile,
  saveProfileFile,
  type ProfileEnv,
  type ProfileFile,
  type ProfileFileLocation,
  type ProviderProfile,
} from '../utils/providerProfile.js'
import {
  DEFAULT_OPENAI_BASE_URL,
  isLocalProviderUrl,
} from '../services/api/providerConfig.js'
import { normalizeRecommendationGoal } from '../utils/providerRecommendation.js'
import { getOllamaChatBaseUrl } from '../utils/providerDiscovery.js'
import { PROTECTED_PROFILE_KEYS, isSensitiveKey } from './redaction.js'
import type {
  BootstrapOptions,
  BootstrapState,
  MidsceneProfileSummary,
  PrimaryMenuOption,
  ProviderOption,
  ProviderProfilePayload,
  ProviderProfileSummary,
} from './types.js'

const DEFAULT_OPENAI_MODEL = 'gpt-4o'
const DEFAULT_OLLAMA_MODEL = 'llama3.2:3b'
export const DEFAULT_MIDSCENE_MODEL_FAMILY = 'doubao-vision'
export const MIDSCENE_MODEL_FAMILIES = [
  'doubao-vision',
  'doubao-seed',
  'qwen2.5-vl',
  'qwen3-vl',
  'qwen3.5',
  'qwen3.6',
  'gemini',
  'vlm-ui-tars',
  'vlm-ui-tars-doubao',
  'vlm-ui-tars-doubao-1.5',
  'glm-v',
  'auto-glm',
  'auto-glm-multilingual',
  'gpt-5',
] as const
const MIDSCENE_ENV_KEYS = [
  'MIDSCENE_MODEL_NAME',
  'MIDSCENE_MODEL_BASE_URL',
  'MIDSCENE_MODEL_API_KEY',
  'MIDSCENE_MODEL_FAMILY',
] as const

export const PRIMARY_MENUS: PrimaryMenuOption[] = [
  { id: 'chat', label: 'Chat', icon: 'message-square' },
  { id: 'memory', label: 'Memory', icon: 'brain' },
  { id: 'assets', label: 'Assets', icon: 'package' },
  { id: 'providers', label: 'Providers', icon: 'plug' },
  { id: 'sessions', label: 'Sessions', icon: 'history' },
  { id: 'tools', label: 'Tools', icon: 'wrench' },
  { id: 'settings', label: 'Settings', icon: 'settings' },
]

export const PROVIDER_OPTIONS: ProviderOption[] = [
  {
    id: 'openai-compatible',
    label: 'OpenAI compatible',
    description: 'Use OpenAI or any compatible endpoint.',
    defaultBaseUrl: DEFAULT_OPENAI_BASE_URL,
    defaultModel: DEFAULT_OPENAI_MODEL,
    requiresApiKey: true,
    localKeyOptional: true,
  },
  {
    id: 'ollama',
    label: 'Ollama',
    description: 'Use a local Ollama model through its chat endpoint.',
    defaultBaseUrl: 'http://127.0.0.1:11434',
    defaultModel: DEFAULT_OLLAMA_MODEL,
    requiresApiKey: false,
  },
  {
    id: 'gemini',
    label: 'Gemini',
    description: 'Use Gemini through the existing profile adapter.',
    defaultBaseUrl: DEFAULT_GEMINI_BASE_URL,
    defaultModel: DEFAULT_GEMINI_MODEL,
    requiresApiKey: true,
  },
  {
    id: 'mistral',
    label: 'Mistral',
    description: 'Use Mistral with the existing profile adapter.',
    defaultBaseUrl: DEFAULT_MISTRAL_BASE_URL,
    defaultModel: DEFAULT_MISTRAL_MODEL,
    requiresApiKey: true,
  },
]

function trimOptional(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function getProfileDisplayName(profile: ProviderProfile): string {
  switch (profile) {
    case 'ollama':
      return 'Ollama'
    case 'gemini':
      return 'Gemini'
    case 'mistral':
      return 'Mistral'
    case 'openai':
      return 'OpenAI compatible'
    default:
      return profile
  }
}

function getProfileModel(env: ProfileEnv): string | undefined {
  return env.OPENAI_MODEL || env.GEMINI_MODEL || env.MISTRAL_MODEL || env.ANTHROPIC_MODEL
}

function getProfileBaseUrl(env: ProfileEnv): string | undefined {
  return (
    env.OPENAI_BASE_URL ||
    env.OPENAI_API_BASE ||
    env.GEMINI_BASE_URL ||
    env.MISTRAL_BASE_URL ||
    env.ANTHROPIC_BASE_URL
  )
}

function getCredentialKeys(env: ProfileEnv): string[] {
  const midsceneKeys = new Set<string>(MIDSCENE_ENV_KEYS)
  return Object.keys(env)
    .filter(key => isSensitiveKey(key) && !midsceneKeys.has(key))
    .sort()
}

function getMidsceneCredentialKeys(env: ProfileEnv): string[] {
  return MIDSCENE_ENV_KEYS
    .filter(key => isSensitiveKey(key) && Boolean(env[key]))
    .sort()
}

export function extractMidsceneEnv(
  env: ProfileEnv | null | undefined,
): ProfileEnv {
  const output: ProfileEnv = {}
  if (!env) return output
  for (const key of MIDSCENE_ENV_KEYS) {
    const value = env[key]
    if (value) output[key] = value
  }
  return output
}

export function buildMidsceneSessionEnv(
  location?: ProfileFileLocation,
): NodeJS.ProcessEnv {
  return { ...extractMidsceneEnv(loadProfileFile(location)?.env) }
}

export function summarizeMidsceneProfile(
  profileFile: ProfileFile | null,
): MidsceneProfileSummary | null {
  if (!profileFile) return null
  const env = profileFile.env
  const credentialKeys = getMidsceneCredentialKeys(env)
  const summary: MidsceneProfileSummary = {
    model: env.MIDSCENE_MODEL_NAME,
    baseUrl: env.MIDSCENE_MODEL_BASE_URL,
    modelFamily: env.MIDSCENE_MODEL_FAMILY,
    credentialConfigured: credentialKeys.length > 0,
    credentialKeys,
  }
  if (
    !summary.model &&
    !summary.baseUrl &&
    !summary.modelFamily &&
    !summary.credentialConfigured
  ) {
    return null
  }
  return summary
}

export function summarizeProfileFile(
  profileFile: ProfileFile | null,
  location?: ProfileFileLocation,
): ProviderProfileSummary | null {
  if (!profileFile) return null
  const credentialKeys = getCredentialKeys(profileFile.env)
  return {
    provider: profileFile.profile,
    displayName: getProfileDisplayName(profileFile.profile),
    model: getProfileModel(profileFile.env),
    baseUrl: getProfileBaseUrl(profileFile.env),
    credentialConfigured: credentialKeys.length > 0,
    credentialKeys,
    filePath: location?.filePath ?? getDefaultProfileFilePath(location?.configDir),
    createdAt: profileFile.createdAt,
  }
}

export function buildBootstrapState(options: BootstrapOptions): BootstrapState {
  const persisted = loadProfileFile(options.profileLocation)
  return {
    cwd: options.cwd,
    permissionMode: options.permissionMode,
    profile: summarizeProfileFile(persisted, options.profileLocation),
    midsceneProfile: summarizeMidsceneProfile(persisted),
    chatSessions: options.chatSessions ?? [],
    activeChatSessionId: options.activeChatSessionId,
    providers: PROVIDER_OPTIONS,
    primaryMenus: PRIMARY_MENUS,
    redaction: {
      profile: 'default',
      protectedKeys: PROTECTED_PROFILE_KEYS,
    },
  }
}

function buildMidsceneEnvFromPayload(
  payload: ProviderProfilePayload['midscene'],
  existingEnv: ProfileEnv = {},
): ProfileEnv {
  const existing = extractMidsceneEnv(existingEnv)
  if (!payload) return existing

  const model = trimOptional(payload.model) ?? existing.MIDSCENE_MODEL_NAME
  const baseUrl = trimOptional(payload.baseUrl) ?? existing.MIDSCENE_MODEL_BASE_URL
  const apiKey = trimOptional(payload.apiKey) ?? existing.MIDSCENE_MODEL_API_KEY
  const modelFamily =
    trimOptional(payload.modelFamily) ??
    existing.MIDSCENE_MODEL_FAMILY ??
    DEFAULT_MIDSCENE_MODEL_FAMILY
  const submittedAnyValue = Boolean(
    trimOptional(payload.model) ||
      trimOptional(payload.baseUrl) ||
      trimOptional(payload.apiKey) ||
      trimOptional(payload.modelFamily),
  )
  const hadExistingValue = Object.keys(existing).length > 0
  if (!submittedAnyValue && !hadExistingValue) return {}
  if (!model || !baseUrl) {
    throw new Error('Midscene model and base URL are required.')
  }

  return {
    MIDSCENE_MODEL_NAME: model,
    MIDSCENE_MODEL_BASE_URL: baseUrl,
    MIDSCENE_MODEL_FAMILY: modelFamily,
    ...(apiKey ? { MIDSCENE_MODEL_API_KEY: apiKey } : {}),
  }
}

function withMidsceneEnv(
  profileFile: ProfileFile,
  midsceneEnv: ProfileEnv,
): ProfileFile {
  return {
    ...profileFile,
    env: {
      ...profileFile.env,
      ...midsceneEnv,
    },
  }
}

function getExistingProviderApiKey(
  provider: ProviderProfilePayload['provider'],
  existingEnv: ProfileEnv,
): string | undefined {
  switch (provider) {
    case 'openai-compatible':
      return trimOptional(existingEnv.OPENAI_API_KEY) ?? trimOptional(existingEnv.OPENAI_API_KEYS)
    case 'gemini':
      return trimOptional(existingEnv.GEMINI_API_KEY)
    case 'mistral':
      return trimOptional(existingEnv.MISTRAL_API_KEY)
    default:
      return undefined
  }
}

export function buildProfileFromPayload(
  payload: ProviderProfilePayload,
  processEnv: NodeJS.ProcessEnv = process.env,
  existingEnv: ProfileEnv = {},
): ProfileFile {
  const provider = payload.provider
  const baseUrl = trimOptional(payload.baseUrl)
  const model = trimOptional(payload.model)
  const apiKey =
    trimOptional(payload.apiKey) ?? getExistingProviderApiKey(provider, existingEnv)
  const midsceneEnv = buildMidsceneEnvFromPayload(payload.midscene, existingEnv)

  switch (provider) {
    case 'openai-compatible': {
      const resolvedBaseUrl = baseUrl ?? DEFAULT_OPENAI_BASE_URL
      let env: ProfileEnv | null
      if (apiKey) {
        env = buildOpenAIProfileEnv({
          goal: normalizeRecommendationGoal(undefined),
          baseUrl: resolvedBaseUrl,
          model: model ?? DEFAULT_OPENAI_MODEL,
          apiKey,
          processEnv,
        })
      } else if (isLocalProviderUrl(resolvedBaseUrl)) {
        env = {
          OPENAI_BASE_URL: resolvedBaseUrl,
          OPENAI_MODEL: model ?? DEFAULT_OPENAI_MODEL,
        }
      } else {
        throw new Error('API key is required for non-local OpenAI-compatible providers.')
      }

      if (!env) {
        throw new Error('OpenAI-compatible profile could not be created.')
      }
      return withMidsceneEnv(createProfileFile('openai', env), midsceneEnv)
    }
    case 'ollama':
      return withMidsceneEnv(
        createProfileFile(
          'ollama',
          buildOllamaProfileEnv(model ?? DEFAULT_OLLAMA_MODEL, {
            baseUrl,
            getOllamaChatBaseUrl,
          }),
        ),
        midsceneEnv,
      )
    case 'gemini': {
      const env = buildGeminiProfileEnv({
        baseUrl: baseUrl ?? DEFAULT_GEMINI_BASE_URL,
        model: model ?? DEFAULT_GEMINI_MODEL,
        apiKey,
        processEnv,
      })
      if (!env) throw new Error('Gemini API key is required.')
      return withMidsceneEnv(createProfileFile('gemini', env), midsceneEnv)
    }
    case 'mistral': {
      const env = buildMistralProfileEnv({
        baseUrl: baseUrl ?? DEFAULT_MISTRAL_BASE_URL,
        model: model ?? DEFAULT_MISTRAL_MODEL,
        apiKey,
        processEnv,
      })
      if (!env) throw new Error('Mistral API key is required.')
      return withMidsceneEnv(createProfileFile('mistral', env), midsceneEnv)
    }
    default:
      throw new Error('Unsupported provider.')
  }
}

export function saveProviderProfileFromPayload(
  payload: ProviderProfilePayload,
  location?: ProfileFileLocation,
): ProviderProfileSummary {
  const existing = loadProfileFile(location)
  const profileFile = buildProfileFromPayload(
    payload,
    process.env,
    existing?.env,
  )
  const filePath = saveProfileFile(profileFile, location)
  return {
    ...summarizeProfileFile(profileFile, { ...location, filePath })!,
    filePath,
  }
}
