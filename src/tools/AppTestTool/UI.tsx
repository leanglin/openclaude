import React from 'react'
import { MessageResponse } from '../../components/MessageResponse.js'
import { TOOL_SUMMARY_MAX_LENGTH } from '../../constants/toolLimits.js'
import { Box, Text } from '../../ink.js'
import type { ProgressMessage } from '../../types/message.js'
import type { ToolProgressData } from '../../Tool.js'
import { truncate } from '../../utils/format.js'
import type { AppTestInput, AppTestResult } from '../../services/appTest/types.js'

export function getToolUseSummary(
  input: Partial<AppTestInput> | undefined,
): string | null {
  if (!input) return null
  const platform = input.platform === 'web' ? 'web' : 'android'
  const target =
    platform === 'web'
      ? input.start_url
      : input.app_package || input.package_name
  const goal = input.test_goal ? `: ${input.test_goal}` : ''
  return truncate(`${platform}${target ? ` ${target}` : ''}${goal}`, TOOL_SUMMARY_MAX_LENGTH)
}

export function renderToolUseMessage(
  input: Partial<AppTestInput>,
  { verbose }: { theme?: string; verbose: boolean },
): React.ReactNode {
  const summary = getToolUseSummary(input)
  if (!summary) return null
  if (verbose) {
    const mode = input.execution_mode || 'midscene_ai'
    return `${summary} (${mode})`
  }
  return summary
}

export function renderToolUseProgressMessage(): React.ReactNode {
  return (
    <MessageResponse height={1}>
      <Text dimColor>Running App/Web test…</Text>
    </MessageResponse>
  )
}

export function renderToolResultMessage(
  output: AppTestResult,
  _progressMessagesForMessage: ProgressMessage<ToolProgressData>[],
  { verbose }: { verbose: boolean },
): React.ReactNode {
  const status = output.success ? 'completed' : 'failed'
  const screenshotCount = output.screenshots.length
  const assertionCount = output.assertions.length
  if (!verbose) {
    return (
      <MessageResponse height={1}>
        <Text>
          App/Web test {status}: <Text bold>{output.message}</Text>
        </Text>
      </MessageResponse>
    )
  }
  return (
    <Box flexDirection="column">
      <MessageResponse height={1}>
        <Text>
          App/Web test {status}: <Text bold>{output.message}</Text>
        </Text>
      </MessageResponse>
      <Box flexDirection="column">
        <Text>Platform: {output.platform}</Text>
        <Text>Execution mode: {output.execution_mode || 'midscene_ai'}</Text>
        <Text>Screenshots: {screenshotCount}</Text>
        <Text>Assertions: {assertionCount}</Text>
        {output.trace_path ? <Text>Trace: {output.trace_path}</Text> : null}
        {output.report_path ? <Text>Report: {output.report_path}</Text> : null}
      </Box>
    </Box>
  )
}
