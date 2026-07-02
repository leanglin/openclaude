import type { PrimaryMenuId } from './types.js'

export type WebUiLayoutState = {
  activePrimaryMenu: PrimaryMenuId
  secondaryCollapsed: boolean
  activityCollapsed: boolean
}

export type WebUiLayoutAction =
  | { type: 'select_primary_menu'; menu: PrimaryMenuId }
  | { type: 'toggle_secondary_panel' }
  | { type: 'set_secondary_collapsed'; collapsed: boolean }
  | { type: 'toggle_activity_panel' }
  | { type: 'set_activity_collapsed'; collapsed: boolean }

export const defaultWebUiLayoutState: WebUiLayoutState = {
  activePrimaryMenu: 'providers',
  secondaryCollapsed: false,
  activityCollapsed: false,
}

export function reduceWebUiLayoutState(
  state: WebUiLayoutState,
  action: WebUiLayoutAction,
): WebUiLayoutState {
  switch (action.type) {
    case 'select_primary_menu':
      return {
        ...state,
        activePrimaryMenu: action.menu,
        secondaryCollapsed: false,
      }
    case 'toggle_secondary_panel':
      return {
        ...state,
        secondaryCollapsed: !state.secondaryCollapsed,
      }
    case 'set_secondary_collapsed':
      return {
        ...state,
        secondaryCollapsed: action.collapsed,
      }
    case 'toggle_activity_panel':
      return {
        ...state,
        activityCollapsed: !state.activityCollapsed,
      }
    case 'set_activity_collapsed':
      return {
        ...state,
        activityCollapsed: action.collapsed,
      }
    default:
      return state
  }
}
