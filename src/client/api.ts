/**
 * Skill studio API client (browser half). Talks to the host route family over
 * same-origin fetch; the host enforces the trust fence on its side.
 */

/** Route paths mirrored from the host (src/routes.ts ROUTES). */
const API = {
  list: '/api/dsh-skill-studio/list',
  read: '/api/dsh-skill-studio/read',
  listDir: '/api/dsh-skill-studio/list-dir',
  readFile: '/api/dsh-skill-studio/read-file',
  write: '/api/dsh-skill-studio/write',
  create: '/api/dsh-skill-studio/create',
  delete: '/api/dsh-skill-studio/delete',
  setEnabled: '/api/dsh-skill-studio/set-enabled',
} as const

/** One skill entry as served by the host. */
export interface SkillEntry {
  name: string
  description: string
  whenToUse?: string
  level: string
  sourceKey: string
  path?: string
  editable: boolean
  modelInvocable: boolean
  userInvocable: boolean
}

/** Group payload served by the host. */
export interface GroupPayload {
  key: string
  title: string
  hint: string
  skills: SkillEntry[]
}

/** List payload served by the host. */
export interface ListPayload {
  cwd: string
  projectRoots: string[]
  groups: GroupPayload[]
}

/** One thrown API error with the host-provided message. */
export class ApiError extends Error {}

/** Skill studio API client. */
export class SkillApi {
  /** Fetch the grouped skill list. */
  async list(cwd?: string): Promise<ListPayload> {
    const query = cwd === undefined ? '' : `?cwd=${encodeURIComponent(cwd)}`
    return this.request<ListPayload>(API.list + query)
  }

  /** Read one SKILL.md (full content + parsed frontmatter). */
  async read(path: string, cwd?: string): Promise<{ path: string; name: string; content: string; frontmatter: Record<string, unknown>; editable: boolean }> {
    return this.request(API.read, { method: 'POST', body: { path, cwd } })
  }

  /** List ONE directory level (the tree loads lazily, one level per expansion). */
  async listDir(dir: string, cwd?: string): Promise<{ dir: string; entries: Array<{ name: string; type: 'directory' | 'file'; size: number | null }>; editable: boolean }> {
    return this.request(API.listDir, { method: 'POST', body: { dir, cwd } })
  }

  /** Read one file inside a skill directory (text, or binary/tooLarge flags). */
  async readFile(path: string, cwd?: string): Promise<{ path: string; size: number; content?: string; binary: boolean; tooLarge: boolean; editable: boolean }> {
    return this.request(API.readFile, { method: 'POST', body: { path, cwd } })
  }

  /** Save edited content of one skill file. */
  async write(path: string, content: string, cwd?: string): Promise<{ ok: true; path: string }> {
    return this.request(API.write, { method: 'POST', body: { path, content, cwd } })
  }

  /** Create a skill file under the user or project root. */
  async create(payload: { root: 'user' | 'project'; name: string; description: string; whenToUse?: string; content: string; cwd: string }): Promise<{ ok: true; name: string; path: string }> {
    return this.request(API.create, { method: 'POST', body: payload })
  }

  /** Delete a skill (moves it into .trash). */
  async remove(path: string, cwd?: string): Promise<{ ok: true; path: string; moved: string }> {
    return this.request(API.delete, { method: 'POST', body: { path, cwd } })
  }

  /** Enable or disable a skill (rewrites disable-model-invocation). */
  async setEnabled(path: string, enabled: boolean, cwd?: string): Promise<{ ok: true; path: string; enabled: boolean }> {
    return this.request(API.setEnabled, { method: 'POST', body: { path, enabled, cwd } })
  }

  private async request<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
    const response = await fetch(path, {
      method: options.method ?? 'GET',
      headers: options.body === undefined ? undefined : { 'content-type': 'application/json' },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    })
    let body: unknown
    try {
      body = await response.json()
    } catch {
      body = undefined
    }
    if (!response.ok) {
      const message = typeof body === 'object' && body !== null && typeof (body as { error?: unknown }).error === 'string'
        ? (body as { error: string }).error
        : `HTTP ${response.status}`
      throw new ApiError(message)
    }
    return body as T
  }
}
