/**
 * skill-studio — host half. Serves the /api/dsh-skill-studio route family
 * (list / read / write / create / delete / set-enabled / health) over the
 * shared trust fence (loopback by default; a live paired-device cookie is an
 * extra allow path). The browser half (./client) registers a tab into the
 * external dsh-better-sidebar right panel.
 *
 * Everything rides official NPM SDK packages — no dsh source changes.
 */

import { homedir } from 'node:os'
import { dirname, sep } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { makeRoutes, ROUTES } from './routes.ts'
import type { CollectOptions } from './collect.ts'

/** Stable cordis plugin name. */
export const name = 'skill-studio'

/** Services required before the routes can mount. */
export const inject = ['webServer', 'sessions', 'agentPresets']

/** Route paths (re-exported for the client contract check). */
export { ROUTES }

/** Skill studio services (skills/sessions/agentPresets come from harness services). */
interface SkillStudioContext {
  webServer: Context['webServer']
  sessions: unknown
  agentPresets: unknown
}

/** Session list surface used to resolve active workspaces. */
interface SessionList {
  list?: () => Array<{ header?: { cwd?: string } }>
}

/** Agent preset roster surface (real path of the composition file). */
interface AgentPresetRoster {
  list?: () => Promise<Array<{ path?: string }>>
}

/** Plugin config. */
export interface Config {
  /** Master switch for the plugin (routes). */
  enabled?: boolean
  /** Extra custom skill root directories. */
  customSkillDirs?: string[]
  /** User dsh config root override (defaults to $DSH_HOME or ~/.dsh). */
  dshHome?: string
  /** User agents config root override (defaults to $DSH_AGENTS_HOME or ~/.agents). */
  agentsHome?: string
}

/** Single-instance guard shared by the plugin family pattern. */
const MOUNTED = Symbol.for('dsh-skill-studio.mounted')

/**
 * Mount the skill studio routes (trust fence looks up remoteWebUiPairing on ctx).
 * @param ctx - host plugin context carrying webServer/sessions/agentPresets.
 * @param config - resolved plugin config.
 */
function applyImpl(ctx: Context, config?: Config): void {
  if (config?.enabled === false) return
  const studioCtx = ctx as unknown as SkillStudioContext
  const dshHome = config?.dshHome ?? process.env.DSH_HOME ?? homedir() + sep + '.dsh'
  const agentsHome = config?.agentsHome ?? process.env.DSH_AGENTS_HOME ?? homedir() + sep + '.agents'
  const customSkillDirs = Array.isArray(config?.customSkillDirs) ? config.customSkillDirs : []

  /** Read-only system skill dirs: <preset dir>/skills of every agent preset. */
  const systemSkillDirs = async (): Promise<string[]> => {
    const presets = studioCtx.agentPresets as AgentPresetRoster | undefined
    if (typeof presets?.list !== 'function') return []
    try {
      const list = await presets.list()
      return list
        .map((preset) => preset.path === undefined ? undefined : dirname(preset.path) + sep + 'skills')
        .filter((dir): dir is string => typeof dir === 'string')
    } catch {
      return []
    }
  }

  /** Active session workspace cwds (degraded to [] when the registry is unavailable). */
  const activeSessionCwds = (): string[] => {
    try {
      const sessions = studioCtx.sessions as SessionList | undefined
      if (typeof sessions?.list !== 'function') return []
      return sessions
        .list()
        .map((session) => session.header?.cwd)
        .filter((cwd): cwd is string => typeof cwd === 'string' && cwd !== '')
    } catch {
      return []
    }
  }

  // System dirs resolve lazily (agentPresets may not be ready at apply
  // time); the list route recollects fresh on every call, so a late
  // resolution only delays the read-only system group, never the routes.
  // The effect callback stays SYNCHRONOUS: cordis treats its return value
  // as the disposer, so an async callback would hand it a Promise.
  ctx.effect(() => {
      let disposers: Array<() => void> = []
      void systemSkillDirs().then((dirs) => {
        const routes = makeRoutes(ctx, {
          dshHome,
          agentsHome,
          customSkillDirs,
          systemSkillDirs: dirs,
          activeSessionCwds,
          logger: { warn: (error: unknown) => ctx.logger.warn(error) },
        })
        disposers = routes.map((route) => ctx.webServer.register(route))
      })
      return () => {
        for (const dispose of disposers) dispose()
      }
    }, 'skill-studio: routes')
}

/** Apply with the single-instance guard (aggregate + standalone coexistence). */
export const apply = ((...args: unknown[]) => {
  const registry = globalThis as { [MOUNTED]?: boolean }
  if (registry[MOUNTED] === true) return
  registry[MOUNTED] = true
  const ctx = args[0] as { effect?: (fn: () => unknown) => unknown } | undefined
  ctx?.effect?.(() => () => { registry[MOUNTED] = false })
  return (applyImpl as unknown as (...a: unknown[]) => unknown)(...args)
}) as typeof applyImpl
