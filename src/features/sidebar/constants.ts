import type * as React from "react"

/**
 * Single source of truth for sidebar sizing, spacing, row radius, and the
 * main content/header corner.
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
  /**
   * One duration for every surface that moves when the sidebar collapses:
   * panel width, row geometry, group labels, content fade, brand. These used to
   * be 150/200/100ms independently, so rows were still resizing 50ms after the
   * panel had settled — a visible snap at the end.
   *
   * Whether motion runs at all is the Settings > reduce motion toggle, applied
   * by the components that gate their transition classes on `useReducedMotion`.
   * Deliberately not sourced from the hardware motion policy: the sidebar
   * animates on low-end machines too, and only the user's toggle turns it off.
   */
  transitionDuration: "160ms",
  transitionEasing: "ease-out",
} as const

export const sidebarStyleVars = {
  "--sidebar-transition-duration": SIDEBAR_TOKENS.transitionDuration,
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
