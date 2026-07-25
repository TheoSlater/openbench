import type * as React from "react"

import { getMotionPolicy } from "@/lib/performance/policy"

/**
 * Single source of truth for sidebar sizing, spacing and radius.
 * Consumed both as JS values and (via `sidebarStyleVars`) as CSS variables,
 * so expanded and collapsed modes stay in lockstep. Don't hardcode these
 * numbers in components — reference the CSS vars (e.g. `h-(--sidebar-item-height)`).
 */
export const SIDEBAR_TOKENS = {
  expandedWidth: "17rem", // ~272px, within the 260–280px target
  collapsedWidth: "4rem", // 64px
  mobileWidth: "18rem",
  sidebarPadding: "0.625rem", // 10px
  itemHeight: "2.5rem", // 40px nav/folder/chat rows
  iconButtonSize: "2.25rem", // 36px collapsed icon hitbox
  iconSize: "1.125rem", // 18px
  itemRadius: "var(--radius-lg)",
  panelRadius: "var(--radius-4xl)",
  sectionGap: "0.5rem", // 8px between sidebar sections
  /** Easing for every surface that moves when the sidebar collapses. */
  transitionEasing: "ease-out",
} as const

/**
 * The collapse transition has one duration, shared by every surface that moves
 * (panel width, row geometry, content fade, rail). They used to be 150/200/100ms
 * independently, which meant rows were still resizing 50ms after the panel had
 * settled — a visible snap at the end. Sourced from the motion policy, so a
 * low-end or reduced-motion profile cuts straight to the final state at 0ms.
 */
export function sidebarTransitionDuration(): string {
  return `${getMotionPolicy().transitionDurationMs}ms`
}

export const sidebarStyleVars = {
  "--sidebar-transition-duration": sidebarTransitionDuration(),
  "--sidebar-transition-easing": SIDEBAR_TOKENS.transitionEasing,
  "--sidebar-width": SIDEBAR_TOKENS.expandedWidth,
  "--sidebar-width-icon": SIDEBAR_TOKENS.collapsedWidth,
  "--sidebar-padding": SIDEBAR_TOKENS.sidebarPadding,
  "--sidebar-item-height": SIDEBAR_TOKENS.itemHeight,
  "--sidebar-icon-button": SIDEBAR_TOKENS.iconButtonSize,
  "--sidebar-icon-size": SIDEBAR_TOKENS.iconSize,
  "--sidebar-item-radius": SIDEBAR_TOKENS.itemRadius,
  "--sidebar-panel-radius": SIDEBAR_TOKENS.panelRadius,
  "--sidebar-section-gap": SIDEBAR_TOKENS.sectionGap,
} as React.CSSProperties
