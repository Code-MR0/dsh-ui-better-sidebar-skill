/**
 * Skill collection and file operations: filesystem scanning (primary) plus
 * the system dirs derived from the deployment's agent presets.
 *
 * The web profile mounts the skill-filesystem provider only at the agent
 * preset scope layer, so the host plane cannot read project/user skills from
 * ctx.skills — the list route scans the official root conventions itself:
 * project `<root>/.dsh/skills` + `<root>/.agents/skills`, user
 * `~/.dsh/skills` + `~/.agents/skills`, and the read-only system dirs
 * `<preset>/skills` of every registered agent preset.
 */

import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join, sep } from 'node:path'
import { parseFrontmatter } from './frontmatter.ts'

/** Display order and copy for each source level. */
export interface SourceGroup {
  key: string
  title: string
  hint: string
}

/** Display groups produced by the collection (order = display order). */
export const SOURCE_GROUPS: SourceGroup[] = [
  { key: 'project', title: 'Project skills', hint: '<project root>/.dsh/skills and .agents/skills' },
  { key: 'user', title: 'Global (user) skills', hint: '~/.dsh/skills and ~/.agents/skills' },
  { key: 'system', title: 'System bundled skills (read-only)', hint: 'Skills shipped with DSH and its plugins' },
]

/** Filesystem precedence across roots (project wins over user wins over system). */
const LEVEL_PRIORITY: ReadonlyMap<string, number> = new Map([
  ['project-dsh', 0],
  ['project-agents', 1],
  ['user-dsh', 2],
  ['user-agents', 3],
  ['system', 4],
])

/** One skill entry as served to the panel. */
export interface SkillEntry {
  name: string
  description: string
  whenToUse?: string
  /** Display group key: project | user | system. */
  level: string
  /** Precise source key (project-dsh / project-agents / user-dsh / user-agents / system). */
  sourceKey: string
  /** Absolute SKILL.md path (every scanned entry has one; system entries are read-only). */
  path?: string
  editable: boolean
  modelInvocable: boolean
  userInvocable: boolean
}

/** Options for collectSkills. */
export interface CollectOptions {
  /** Project roots to scan (each scans .dsh/skills and .agents/skills). */
  projectRoots?: string[]
  /** Extra custom skill roots. */
  customSkillDirs?: string[]
  /** User dsh config root (~/.dsh). */
  dshHome: string
  /** User agents config root (~/.agents). */
  agentsHome: string
  /** Read-only system skill dirs (deployment agent presets). */
  systemSkillDirs?: string[]
}

/** Group payload served by the list route. */
export interface GroupPayload {
  key: string
  title: string
  hint: string
  skills: SkillEntry[]
}

/** List payload served by the list route. */
export interface ListPayload {
  cwd: string
  projectRoots: string[]
  groups: GroupPayload[]
}

/** Find the nearest ancestor directory containing .git (cwd itself when none). */
export function findProjectRoot(cwd: string): string {
  let current = cwd
  for (;;) {
    if (existsSync(join(current, '.git'))) return current
    const parent = dirname(current)
    if (parent === current) return cwd
    current = parent
  }
}

/** Scan one skill root (one level: <name>/SKILL.md or <name>.md). */
async function scanSkillRoot(root: string, level: string, into: Map<string, SkillEntry>): Promise<void> {
  if (!existsSync(root)) return
  let entries
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const name = entry.name
    let file: string
    if (entry.isDirectory()) file = join(root, name, 'SKILL.md')
    else if (entry.isFile() && name.endsWith('.md')) file = join(root, name)
    else continue
    if (!existsSync(file)) continue
    let content: string
    try {
      content = await readFile(file, 'utf8')
    } catch {
      continue
    }
    const parsed = parseFrontmatter(content)
    const skillName = parsed.name ?? name.replace(/\.md$/, '')
    if (!/^[a-z0-9][a-z0-9-]*$/.test(skillName)) continue
    const priority = LEVEL_PRIORITY.get(level) ?? 99
    const existing = into.get(skillName)
    if (existing !== undefined && (LEVEL_PRIORITY.get(existing.sourceKey) ?? 99) <= priority) continue
    into.set(skillName, {
      name: skillName,
      description: parsed.description ?? '(no description)',
      whenToUse: parsed.whenToUse,
      level: level.startsWith('project') ? 'project' : level.startsWith('user') ? 'user' : 'system',
      sourceKey: level,
      path: file,
      editable: level !== 'system',
      modelInvocable: parsed.disableModelInvocation !== true,
      userInvocable: parsed.userInvocable !== false,
    })
  }
}

/** Collect grouped skills by scanning every root (project wins on conflicts). */
export async function collectSkills(options: CollectOptions): Promise<SkillEntry[]> {
  const byName = new Map<string, SkillEntry>()
  const roots = new Set<string>(options.projectRoots !== undefined && options.projectRoots.length > 0 ? options.projectRoots : [process.cwd()])
  const tasks: Array<Promise<void>> = []
  for (const root of roots) {
    tasks.push(scanSkillRoot(join(root, '.dsh', 'skills'), 'project-dsh', byName))
    tasks.push(scanSkillRoot(join(root, '.agents', 'skills'), 'project-agents', byName))
  }
  for (const dir of options.customSkillDirs ?? []) tasks.push(scanSkillRoot(dir, 'custom', byName))
  tasks.push(scanSkillRoot(join(options.dshHome, 'skills'), 'user-dsh', byName))
  tasks.push(scanSkillRoot(join(options.agentsHome, 'skills'), 'user-agents', byName))
  for (const dir of options.systemSkillDirs ?? []) tasks.push(scanSkillRoot(dir, 'system', byName))
  await Promise.all(tasks)
  return [...byName.values()]
}

/** Build the list payload (grouped by level, sorted by name inside each group). */
export function buildPayload(skills: SkillEntry[], cwd: string, projectRoots: string[]): ListPayload {
  const byLevel = new Map<string, SkillEntry[]>()
  for (const skill of skills) {
    const list = byLevel.get(skill.level) ?? []
    list.push(skill)
    byLevel.set(skill.level, list)
  }
  const known = new Set(SOURCE_GROUPS.map((group) => group.key))
  const groups: GroupPayload[] = SOURCE_GROUPS
    .map((group) => ({
      key: group.key,
      title: group.title,
      hint: group.hint,
      skills: (byLevel.get(group.key) ?? []).sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .filter((group) => group.skills.length > 0)
  const leftovers: GroupPayload[] = [...byLevel.entries()]
    .filter(([key]) => !known.has(key))
    .map(([key, list]) => ({
      key,
      title: `Other (${key})`,
      hint: '',
      skills: list.sort((a, b) => a.name.localeCompare(b.name)),
    }))
  return { cwd, projectRoots, groups: [...groups, ...leftovers] }
}

/** Single-quote a YAML scalar (doubling embedded quotes). */
function yamlQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

/** Build the new skill file content (create route). */
export function buildSkillContent(name: string, description: string, whenToUse: string | undefined, content: string, disabled: boolean): string {
  const lines = ['---', `name: ${name}`, `description: ${yamlQuote(description.replace(/[\r\n]/gu, ' '))}`]
  if (typeof whenToUse === 'string' && whenToUse.trim() !== '') lines.push(`whenToUse: ${yamlQuote(whenToUse.replace(/[\r\n]/gu, ' '))}`)
  if (disabled === true) lines.push('disable-model-invocation: true')
  lines.push('---', '', content.trim(), '')
  return lines.join('\n')
}

/** Create a skill file (mkdir -p + write). Returns the absolute target path. */
export async function writeSkillFile(baseDir: string, name: string, description: string, whenToUse: string | undefined, content: string): Promise<string> {
  const targetDir = join(baseDir, name)
  const target = join(targetDir, 'SKILL.md')
  if (existsSync(target)) throw new Error(`skill ${name} already exists at ${target}`)
  await mkdir(targetDir, { recursive: true })
  await writeFile(target, buildSkillContent(name, description.trim(), whenToUse, content, false), 'utf8')
  return target
}

/** Move a skill file into its .trash sibling directory (recoverable delete). */
export async function trashSkillFile(path: string): Promise<string> {
  const trashDir = join(dirname(path), '.trash')
  await mkdir(trashDir, { recursive: true })
  const trashTarget = join(trashDir, `${Date.now()}-SKILL.md`)
  await rename(path, trashTarget)
  return trashTarget
}

/** User skill root convention. */
export function userSkillRoot(dshHome: string): string {
  return join(dshHome, 'skills')
}

/** Project skill root convention (project root + .dsh/skills). */
export function projectSkillRoot(projectRoot: string): string {
  return `${projectRoot}${sep}.dsh${sep}skills`
}
