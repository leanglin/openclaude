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
  PrimaryMenuOption,
  ProviderOption,
  ProviderProfilePayload,
  ProviderProfileSummary,
} from './types.js'

const DEFAULT_OPENAI_MODEL = 'gpt-4o'
const DEFAULT_OLLAMA_MODEL = 'llama3.2:3b'

export const PRIMARY_MENUS: PrimaryMenuOption[] = [
  { id: 'chat', label: 'Chat', icon: 'message-square' },
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
  return Object.keys(env)
    .filter(isSensitiveKey)
    .sort()
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
    providers: PROVIDER_OPTIONS,
    primaryMenus: PRIMARY_MENUS,
    redaction: {
      profile: 'default',
      protectedKeys: PROTECTED_PROFILE_KEYS,
    },
  }
}

export function buildProfileFromPayload(
  payload: ProviderProfilePayload,
  processEnv: NodeJS.ProcessEnv = process.env,
): ProfileFile {
  const provider = payload.provider
  const baseUrl = trimOptional(payload.baseUrl)
  const model = trimOptional(payload.model)
  const apiKey = trimOptional(payload.apiKey)

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
      return createProfileFile('openai', env)
    }
    case 'ollama':
      return createProfileFile(
        'ollama',
        buildOllamaProfileEnv(model ?? DEFAULT_OLLAMA_MODEL, {
          baseUrl,
          getOllamaChatBaseUrl,
        }),
      )
    case 'gemini': {
      const env = buildGeminiProfileEnv({
        baseUrl: baseUrl ?? DEFAULT_GEMINI_BASE_URL,
        model: model ?? DEFAULT_GEMINI_MODEL,
        apiKey,
        processEnv,
      })
      if (!env) throw new Error('Gemini API key is required.')
      return createProfileFile('gemini', env)
    }
    case 'mistral': {
      const env = buildMistralProfileEnv({
        baseUrl: baseUrl ?? DEFAULT_MISTRAL_BASE_URL,
        model: model ?? DEFAULT_MISTRAL_MODEL,
        apiKey,
        processEnv,
      })
      if (!env) throw new Error('Mistral API key is required.')
      return createProfileFile('mistral', env)
    }
    default:
      throw new Error('Unsupported provider.')
  }
}

export function saveProviderProfileFromPayload(
  payload: ProviderProfilePayload,
  location?: ProfileFileLocation,
): ProviderProfileSummary {
  const profileFile = buildProfileFromPayload(payload)
  const filePath = saveProfileFile(profileFile, location)
  return {
    ...summarizeProfileFile(profileFile, { ...location, filePath })!,
    filePath,
  }
}
