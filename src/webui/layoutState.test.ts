import { describe, expect, test } from 'bun:test'
import {
  defaultWebUiLayoutState,
  reduceWebUiLayoutState,
} from './layoutState.js'

describe('webui layout state reducer', () => {
  test('collapses and expands the secondary provider panel', () => {
    const collapsed = reduceWebUiLayoutState(defaultWebUiLayoutState, {
      type: 'toggle_secondary_panel',
    })
    expect(collapsed.secondaryCollapsed).toBe(true)

    const expanded = reduceWebUiLayoutState(collapsed, {
      type: 'set_secondary_collapsed',
      collapsed: false,
    })
    expect(expanded.secondaryCollapsed).toBe(false)
  })

  test('collapses the activity panel independently', () => {
    const collapsed = reduceWebUiLayoutState(defaultWebUiLayoutState, {
      type: 'toggle_activity_panel',
    })
    expect(collapsed.activityCollapsed).toBe(true)
    expect(collapsed.secondaryCollapsed).toBe(false)
  })

  test('selecting a primary menu reopens the secondary panel', () => {
    const state = reduceWebUiLayoutState(
      { ...defaultWebUiLayoutState, secondaryCollapsed: true },
      { type: 'select_primary_menu', menu: 'tools' },
    )

    expect(state.activePrimaryMenu).toBe('tools')
    expect(state.secondaryCollapsed).toBe(false)
  })
})
