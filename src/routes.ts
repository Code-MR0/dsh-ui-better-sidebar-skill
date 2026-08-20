/**
 * The /api/dsh-skill-studio route family: list (grouped by source), read a
 * SKILL.md, write (save edited content), create, delete (move to .trash),
 * set-enabled (rewrites disable-model-invocation frontmatter) and health.
 * Every route carries the shared trust fence (loopback by default; a live
 * paired-device cookie is an extra allow path when remote-web-ui is loaded)
 * plus browser same-origin markers — the write routes touch real skill
 * files, so unpaired LAN clients must not reach them.
 */

import { readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { isSkillStudioAllowed } from './access.ts'
import {
  buildPayload, collectSkills, findProjectRoot, projectSkillRoot, trashSkillFile,
  userSkillRoot, writeSkillFile, type CollectOptions, type SkillEntry,
} from './collect.ts'
import { parseFrontmatter, setFrontmatterField } from './frontmatter.ts'

/** Cap on JSON request bodies. */
const MAX_JSON_BODY_BYTES = 1 * 1024 * 1024

/** Route paths (client bundle mirrors these literals; tests assert both sides). */
export const ROUTES = {
  list: '/api/dsh-skill-studio/list',
  read: '/api/dsh-skill-studio/read',
  listDir: '/api/dsh-skill-studio/list-dir',
  readFile: '/api/dsh-skill-studio/read-file',
  write: '/api/dsh-skill-studio/write',
  create: '/api/dsh-skill-studio/create',
  delete: '/api/dsh-skill-studio/delete',
  setEnabled: '/api/dsh-skill-studio/set-enabled',
  health: '/api/dsh-skill-studio/health',
} as const

/** One JSON response. */
function writeJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'referrer-policy': 'no-referrer' })
  res.end(payload)
}

/** Read a JSON request body (undefined when too large or unparseable). */
async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown> | undefined> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = chunk as Buffer
    size += buffer.length
    if (size > MAX_JSON_BODY_BYTES) return undefined
    chunks.push(buffer)
  }
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : undefined
  } catch {
    return undefined
  }
}

/** URL query helper (first value, decoded). */
function queryParam(url: URL, name: string): string | undefined {
  const value = url.searchParams.get(name)
  return value === null ? undefined : value
}

/** Skill name pattern shared by the routes (kebab-case). */
const NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/

/** Normalize a client-supplied path (resolve + strip trailing slash). */
function normalizePath(path: string): string {
  const resolved = path.trim()
  return resolved.endsWith('/') ? resolved.slice(0, -1) : resolved
}

/** Route family dependencies (tests inject fakes). */
export interface SkillRoutesDeps {
  /** User dsh config root (~/.dsh). */
  dshHome: string
  /** User agents config root (~/.agents). */
  agentsHome: string
  /** Extra custom skill roots from plugin config. */
  customSkillDirs: string[]
  /** Read-only system skill dirs (deployment agent presets). */
  systemSkillDirs: string[]
  /** Active session cwd list (project root base). */
  activeSessionCwds(): string[]
  /** Logger. */
  logger: { warn(error: unknown): void }
}

/** Default process cwd fallback (overridable in tests). */
export const DEFAULT_CWD = (): string => process.cwd()

/**
 * Build every /api/dsh-skill-studio route (exact paths).
 * @param ctx - host context; may expose remoteWebUiPairing.
 * @param deps - dshHome/agentsHome/systemSkillDirs/sessions.
 * @returns the route list for ctx.webServer.register.
 */
export function makeRoutes(ctx: Context, deps: SkillRoutesDeps): WebRoute[] {
  const { dshHome, agentsHome, customSkillDirs, systemSkillDirs, activeSessionCwds, logger } = deps

  /** Guard helper: fence + method check. */
  const guard = (req: IncomingMessage, res: ServerResponse, method: string): boolean => {
    if (!isSkillStudioAllowed(ctx, req)) {
      writeJson(res, 403, { error: 'forbidden: loopback-only' })
      return false
    }
    if (req.method !== method) {
      writeJson(res, 405, { error: `method not allowed: ${req.method}` })
      return false
    }
    return true
  }

  /** Active session project roots (degraded to [] when sessions throw). */
  const sessionProjectRoots = (): string[] => {
    try {
      return activeSessionCwds().map((sessionCwd) => findProjectRoot(sessionCwd))
    } catch {
      return []
    }
  }

  /** Collect options shared by the handlers. */
  const collectOptions = (cwd: string): CollectOptions => ({
    projectRoots: sessionProjectRoots(),
    customSkillDirs,
    dshHome,
    agentsHome,
    systemSkillDirs,
  })

  /**
   * Find a skill entry by exact path from a FRESH collection pass. Write
   * routes only trust scanned paths — a request can never name an arbitrary
   * file. Returns undefined when the path is not a known skill file.
   */
  const findSkillByPath = async (path: string, cwd: string): Promise<SkillEntry | undefined> => {
    const target = normalizePath(path)
    const skills = await collectSkills(collectOptions(cwd))
    return skills.find((candidate) => candidate.path !== undefined && normalizePath(candidate.path) === target)
  }

  /** Every editable/readable skill root for the given cwd (project + user + system). */
  const skillRoots = (cwd: string): string[] => {
    const roots: string[] = []
    const projectRoots = sessionProjectRoots().length > 0 ? sessionProjectRoots() : [findProjectRoot(cwd)]
    for (const projectRoot of projectRoots) {
      roots.push(projectSkillRoot(projectRoot))
      roots.push(join(projectRoot, '.agents', 'skills'))
    }
    roots.push(userSkillRoot(dshHome))
    roots.push(join(agentsHome, 'skills'))
    for (const dir of systemSkillDirs) roots.push(dir)
    return roots
  }

  /** Classify a path: editable (project/user) or read-only (system), or throw when outside every root. */
  const classifyPath = (path: string, cwd: string): { editable: boolean } => {
    const target = normalizePath(path)
    const under = (root: string): boolean => target === root || target.startsWith(root + '/')
    for (const root of systemSkillDirs) if (under(root)) return { editable: false }
    for (const root of skillRoots(cwd)) {
      if (systemSkillDirs.includes(root)) continue
      if (under(root)) return { editable: true }
    }
    throw new Error('path outside skill roots: ' + path)
  }

  /** Parse the body and extract one required string field. */
  const requireString = (body: Record<string, unknown> | undefined, key: string): string | undefined => {
    const value = body?.[key]
    return typeof value === 'string' && value.trim() !== '' ? value : undefined
  }

  const routes: WebRoute[] = [
    {
      kind: 'exact',
      path: ROUTES.list,
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (!guard(req, res, 'GET')) return
        try {
          const url = new URL(req.url ?? '/', 'http://x')
          const cwd = queryParam(url, 'cwd') ?? DEFAULT_CWD()
          const projectRoots = sessionProjectRoots()
          const skills = await collectSkills(collectOptions(cwd))
          writeJson(res, 200, buildPayload(skills, cwd, [...new Set(projectRoots)]))
        } catch (error) {
          logger.warn(error)
          writeJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
        }
      },
    },
    {
      kind: 'exact',
      path: ROUTES.read,
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (!guard(req, res, 'POST')) return
        try {
          const body = await readJsonBody(req)
          const path = requireString(body, 'path')
          const cwd = requireString(body, 'cwd') ?? DEFAULT_CWD()
          if (path === undefined) {
            writeJson(res, 400, { error: 'expected { path }' })
            return
          }
          const skill = await findSkillByPath(path, cwd)
          if (skill === undefined || skill.path === undefined) {
            writeJson(res, 404, { error: `unknown skill file: ${path}` })
            return
          }
          const content = await readFile(skill.path, 'utf8')
          writeJson(res, 200, {
            path: skill.path,
            name: skill.name,
            content,
            frontmatter: parseFrontmatter(content),
            editable: skill.editable,
          })
        } catch (error) {
          logger.warn(error)
          writeJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
        }
      },
    },
    {
      kind: 'exact',
      path: ROUTES.listDir,
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (!guard(req, res, 'POST')) return
        try {
          const body = await readJsonBody(req)
          const dir = requireString(body, 'dir')
          const cwd = requireString(body, 'cwd') ?? DEFAULT_CWD()
          if (dir === undefined) {
            writeJson(res, 400, { error: 'expected { dir }' })
            return
          }
          // Validate the directory lives under the skill roots, then list ONE
          // level (the tree loads lazily, one level per expansion).
          const cls = classifyPath(dir, cwd)
          const info = await stat(normalizePath(dir))
          if (info === undefined || !info.isDirectory()) {
            writeJson(res, 400, { error: `not a directory: ${dir}` })
            return
          }
          const entries = await readdir(normalizePath(dir), { withFileTypes: true })
          entries.sort((a, b) => {
            const ad = a.isDirectory() ? 0 : 1
            const bd = b.isDirectory() ? 0 : 1
            return (ad - bd) || a.name.localeCompare(b.name)
          })
          const rows: Array<{ name: string; type: 'directory' | 'file'; size: number | null }> = []
          for (const entry of entries) {
            if (entry.isDirectory()) {
              rows.push({ name: entry.name, type: 'directory', size: null })
            } else if (entry.isFile()) {
              let size: number | null = null
              try {
                const fileInfo = await stat(join(normalizePath(dir), entry.name))
                size = fileInfo.size
              } catch {
                // keep null
              }
              rows.push({ name: entry.name, type: 'file', size })
            }
          }
          writeJson(res, 200, { dir, entries: rows, editable: cls.editable })
        } catch (error) {
          logger.warn(error)
          writeJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
        }
      },
    },
    {
      kind: 'exact',
      path: ROUTES.readFile,
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (!guard(req, res, 'POST')) return
        try {
          const body = await readJsonBody(req)
          const path = requireString(body, 'path')
          const cwd = requireString(body, 'cwd') ?? DEFAULT_CWD()
          if (path === undefined) {
            writeJson(res, 400, { error: 'expected { path }' })
            return
          }
          const cls = classifyPath(path, cwd)
          const info = await stat(normalizePath(path))
          const size = info.size
          if (size > 512 * 1024) {
            writeJson(res, 200, { path, size, binary: false, tooLarge: true, editable: cls.editable })
            return
          }
          let content: string
          try {
            content = await readFile(normalizePath(path), 'utf8')
          } catch {
            writeJson(res, 200, { path, size, binary: true, tooLarge: false, editable: cls.editable })
            return
          }
          writeJson(res, 200, { path, size, content, binary: false, tooLarge: false, editable: cls.editable })
        } catch (error) {
          logger.warn(error)
          writeJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
        }
      },
    },
    {
      kind: 'exact',
      path: ROUTES.write,
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (!guard(req, res, 'POST')) return
        try {
          const body = await readJsonBody(req)
          const path = requireString(body, 'path')
          const content = body?.content
          const cwd = requireString(body, 'cwd') ?? DEFAULT_CWD()
          if (path === undefined || typeof content !== 'string') {
            writeJson(res, 400, { error: 'expected { path, content }' })
            return
          }
          if (Buffer.byteLength(content, 'utf8') > 1 * 1024 * 1024) {
            writeJson(res, 400, { error: 'content exceeds 1MB limit' })
            return
          }
          const cls = classifyPath(path, cwd)
          if (!cls.editable) {
            writeJson(res, 403, { error: `read-only skill (system bundled): ${path}` })
            return
          }
          await writeFile(normalizePath(path), content, 'utf8')
          writeJson(res, 200, { ok: true, path })
        } catch (error) {
          logger.warn(error)
          writeJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
        }
      },
    },
    {
      kind: 'exact',
      path: ROUTES.create,
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (!guard(req, res, 'POST')) return
        try {
          const body = await readJsonBody(req)
          const root = body?.root
          const name = requireString(body, 'name')
          const description = requireString(body, 'description')
          const whenToUse = typeof body?.whenToUse === 'string' && body.whenToUse.trim() !== '' ? body.whenToUse : undefined
          const content = typeof body?.content === 'string' ? body.content : undefined
          const cwd = requireString(body, 'cwd')
          if (root !== 'user' && root !== 'project') {
            writeJson(res, 400, { error: 'root must be user (~/.dsh/skills) or project (project .dsh/skills)' })
            return
          }
          if (cwd === undefined) {
            writeJson(res, 400, { error: 'cwd is required (the workspace shown by the panel)' })
            return
          }
          if (name === undefined || !NAME_PATTERN.test(name)) {
            writeJson(res, 400, { error: 'name must be kebab-case (lowercase letters/digits first)' })
            return
          }
          if (description === undefined) {
            writeJson(res, 400, { error: 'description is required' })
            return
          }
          if (content === undefined || content.trim() === '') {
            writeJson(res, 400, { error: 'content is required' })
            return
          }
          if (Buffer.byteLength(content, 'utf8') > 512 * 1024) {
            writeJson(res, 400, { error: 'content exceeds 512KB limit' })
            return
          }
          const baseDir = root === 'user'
            ? userSkillRoot(dshHome)
            : projectSkillRoot(findProjectRoot(cwd))
          const target = await writeSkillFile(baseDir, name, description, whenToUse, content)
          writeJson(res, 200, { ok: true, name, path: target })
        } catch (error) {
          if (error instanceof Error && /already exists/.test(error.message)) {
            writeJson(res, 409, { error: error.message })
            return
          }
          logger.warn(error)
          writeJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
        }
      },
    },
    {
      kind: 'exact',
      path: ROUTES.delete,
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (!guard(req, res, 'POST')) return
        try {
          const body = await readJsonBody(req)
          const path = requireString(body, 'path')
          const cwd = requireString(body, 'cwd') ?? DEFAULT_CWD()
          if (path === undefined) {
            writeJson(res, 400, { error: 'expected { path }' })
            return
          }
          const skill = await findSkillByPath(path, cwd)
          if (skill === undefined || skill.path === undefined) {
            writeJson(res, 404, { error: `unknown skill file: ${path}` })
            return
          }
          if (!skill.editable) {
            writeJson(res, 403, { error: `read-only skill (system bundled): ${path}` })
            return
          }
          const moved = await trashSkillFile(skill.path)
          writeJson(res, 200, { ok: true, path: skill.path, moved })
        } catch (error) {
          logger.warn(error)
          writeJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
        }
      },
    },
    {
      kind: 'exact',
      path: ROUTES.setEnabled,
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (!guard(req, res, 'POST')) return
        try {
          const body = await readJsonBody(req)
          const path = requireString(body, 'path')
          const enabled = body?.enabled
          const cwd = requireString(body, 'cwd') ?? DEFAULT_CWD()
          if (path === undefined || typeof enabled !== 'boolean') {
            writeJson(res, 400, { error: 'expected { path, enabled }' })
            return
          }
          const skill = await findSkillByPath(path, cwd)
          if (skill === undefined || skill.path === undefined) {
            writeJson(res, 404, { error: `unknown skill file: ${path}` })
            return
          }
          if (!skill.editable) {
            writeJson(res, 403, { error: `read-only skill (system bundled): ${path}` })
            return
          }
          // Enabled = disable-model-invocation: false; disabled = true.
          const frontmatter = setFrontmatterField(skill.path, 'disable-model-invocation', enabled ? false : true)
          writeJson(res, 200, {
            ok: true,
            path: skill.path,
            enabled: frontmatter.disableModelInvocation !== true,
          })
        } catch (error) {
          logger.warn(error)
          writeJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
        }
      },
    },
    {
      kind: 'exact',
      path: ROUTES.health,
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (!guard(req, res, 'GET')) return
        try {
          const skills = await collectSkills(collectOptions(DEFAULT_CWD()))
          writeJson(res, 200, { ok: true, plugin: 'skill-studio', skills: skills.length })
        } catch (error) {
          logger.warn(error)
          writeJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
        }
      },
    },
  ]
  return routes
}
