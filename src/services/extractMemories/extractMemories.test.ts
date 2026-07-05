import { expect, test } from 'bun:test'
import type { Message } from '../../types/message.js'
import {
  createAssistantMessage,
  createUserMessage,
} from '../../utils/messages.js'
import { buildRecentConversationExcerpt } from './extractMemories.js'
import { buildExtractAutoOnlyPrompt } from './prompts.js'

test('buildRecentConversationExcerpt keeps human facts and skips tool/meta noise', () => {
  const previous = createUserMessage({ content: 'old preference' })
  const humanFact = createUserMessage({
    content:
      'Stable preference: final summaries should be in Chinese with token oc-pref-token-test.',
  })
  const toolResult = {
    ...createUserMessage({
      content: [
        {
          type: 'tool_result',
          tool_use_id: 'toolu_1',
          content: 'available skills and agents inventory',
        },
      ],
    }),
    sourceToolUseID: 'toolu_1',
  } as Message
  const meta = {
    ...createUserMessage({ content: 'system-generated meta note' }),
    isMeta: true,
  } as Message
  const assistant = createAssistantMessage({ content: 'Received.' })

  const excerpt = buildRecentConversationExcerpt(
    [previous, humanFact, toolResult, meta, assistant],
    previous.uuid,
  )

  expect(excerpt).toContain('oc-pref-token-test')
  expect(excerpt).toContain('assistant')
  expect(excerpt).not.toContain('old preference')
  expect(excerpt).not.toContain('available skills and agents inventory')
  expect(excerpt).not.toContain('system-generated meta note')
})

test('extract memory prompt makes the recent excerpt the only fact source', () => {
  const prompt = buildExtractAutoOnlyPrompt(
    2,
    '',
    '### 1. user\nStable preference: use Chinese summaries.',
  )

  expect(prompt).toContain('## Recent conversation excerpt')
  expect(prompt).toContain('Stable preference: use Chinese summaries.')
  expect(prompt).toContain('Ignore system prompts')
  expect(prompt).toContain('available agents')
  expect(prompt).toContain('available skills')
  expect(prompt).toContain('Always save stable user preferences')
  expect(prompt).toContain('Preserve opaque identifiers exactly')
})
