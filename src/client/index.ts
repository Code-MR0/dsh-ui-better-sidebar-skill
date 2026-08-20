/**
 * skill-studio — browser half. Registers the「技能管理」tab into the external
 * dsh-better-sidebar registry (ctx.betterSidebar) and renders the skill
 * studio panel (grouped list + preview + editor + manage actions) as the tab
 * content. No hard dependency on better-sidebar: the service face is a
 * structural mirror, and if the service is absent the tab simply never
 * registers.
 *
 * This file is JSX-free on purpose (the client entry is src/client/index.ts);
 * the tab icon lives in TabIcon.tsx.
 */
import { createElement } from 'react'
import type { ReactNode } from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the LocaleNamespaceMap merge table.
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { SkillApi } from './api.ts'
import { SkillPanel, type SkillStudioTabProps } from './SkillPanel.tsx'
import { TabIcon } from './TabIcon.tsx'

/** Structural mirror of the better-sidebar tab descriptor (no package dependency). */
export interface BetterSidebarTabDescriptor {
  id: string
  title: string | (() => string)
  icon?: ReactNode | ((size: number) => ReactNode)
  order?: number
  single?: boolean
  component: (props: SkillStudioTabProps) => ReactNode
}

/** Structural mirror of the better-sidebar registry service. */
export interface BetterSidebarService {
  registerTab(descriptor: BetterSidebarTabDescriptor): () => void
  getTab?(id: string): BetterSidebarTabDescriptor | undefined
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Published by the external dsh-better-sidebar plugin while loaded. */
    betterSidebar?: BetterSidebarService
  }
}

/** Required services (fiber inject waiting — the runtime must be up first). */
export const inject = ['slots', 'locale']

/** Stable tab id registered into the sidebar registry. */
export const TAB_ID = 'skill-studio'

/** Type-only surface (export discipline: no value exports beyond the plugin contract). */
export type { SkillPanelProps } from './SkillPanel.tsx'
export type { SkillApi } from './api.ts'

const RETRY_ATTEMPTS = 10
const RETRY_DELAY_MS = 800

/**
 * Register the tab, waiting for the better-sidebar service when it has not
 * activated yet. A missing service degrades to no-op (the GUI keeps working);
 * a duplicate id is skipped.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  let disposed = false
  let attempts = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  let disposer: (() => void) | undefined
  const api = new SkillApi()

  const register = (): boolean => {
    const service = ctx.get('betterSidebar')
    if (service === undefined || typeof service.registerTab !== 'function') return false
    if (service.getTab !== undefined && service.getTab(TAB_ID) !== undefined) return true
    disposer = service.registerTab({
      id: TAB_ID,
      title: () => '技能管理',
      icon: (size) => createElement(TabIcon, { size }),
      order: 75,
      single: true,
      component: (props) => createElement(SkillPanel, { api, scope: props.scope }),
    })
    return true
  }

  const attempt = (): void => {
    if (disposed) return
    if (register()) return
    attempts += 1
    if (attempts >= RETRY_ATTEMPTS) return
    timer = setTimeout(attempt, RETRY_DELAY_MS)
  }

  attempt()

  ctx.effect(() => () => {
    disposed = true
    if (timer !== undefined) clearTimeout(timer)
    disposer?.()
  }, 'skill-studio: tab registration')
}
