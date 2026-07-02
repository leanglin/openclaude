const SECRET_KEY_PATTERN =
  /(api[_-]?key|token|secret|password|credential|authorization|auth[_-]?header)/i

const SECRET_VALUE_PATTERNS = [
  /\bsk-[A-Za-z0-9_-]{16,}\b/g,
  /\bsk-ant-[A-Za-z0-9_-]{16,}\b/g,
  /\bAIza[0-9A-Za-z_-]{20,}\b/g,
  /\bgh[pousr]_[0-9A-Za-z_]{20,}\b/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}\b/gi,
]

export const PROTECTED_PROFILE_KEYS = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_CUSTOM_HEADERS',
  'OPENAI_API_KEY',
  'OPENAI_API_KEYS',
  'OPENAI_AUTH_HEADER_VALUE',
  'CODEX_API_KEY',
  'GEMINI_API_KEY',
  'GEMINI_ACCESS_TOKEN',
  'GOOGLE_API_KEY',
  'MISTRAL_API_KEY',
  'MIDSCENE_MODEL_API_KEY',
]

export function isSensitiveKey(key: string): boolean {
  return SECRET_KEY_PATTERN.test(key)
}

export function collectKnownSecrets(
  env: Record<string, string | undefined> = process.env,
): string[] {
  const secrets = new Set<string>()
  for (const [key, value] of Object.entries(env)) {
    if (value && isSensitiveKey(key) && value.length >= 4) {
      secrets.add(value)
    }
  }
  return [...secrets]
}

export function redactSensitiveText(
  value: string,
  additionalSecrets: readonly string[] = [],
): string {
  let redacted = value
  for (const secret of additionalSecrets) {
    if (!secret || secret.length < 4) continue
    redacted = redacted.split(secret).join('[redacted]')
  }
  for (const pattern of SECRET_VALUE_PATTERNS) {
    redacted = redacted.replace(pattern, '[redacted]')
  }
  return redacted
}

export function redactServerEvent<T>(
  value: T,
  additionalSecrets: readonly string[] = [],
): T {
  if (typeof value === 'string') {
    return redactSensitiveText(value, additionalSecrets) as T
  }
  if (Array.isArray(value)) {
    return value.map(item => redactServerEvent(item, additionalSecrets)) as T
  }
  if (!value || typeof value !== 'object') {
    return value
  }

  const output: Record<string, unknown> = {}
  for (const [key, nested] of Object.entries(value)) {
    if (isSensitiveKey(key)) {
      output[key] = '[redacted]'
    } else {
      output[key] = redactServerEvent(nested, additionalSecrets)
    }
  }
  return output as T
}
