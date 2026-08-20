/**
 * Skill import from a ZIP archive (host half): extract a skill directory
 * (SKILL.md plus every other file) from an uploaded zip into a skill root.
 * Entry names are validated against path traversal (zip-slip) before any
 * write; the target name must be kebab-case.
 */
import AdmZip from 'adm-zip'
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { join, normalize, sep } from 'node:path'

/** Skill name pattern (kebab-case). */
const NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/

/** Result of a successful import. */
export interface ZipImportResult {
  name: string
  /** Absolute directory the skill was written to. */
  skillDir: string
  /** Absolute SKILL.md path of the imported skill. */
  skillPath: string
}

/**
 * Validate one zip entry name for path traversal (zip-slip): refuse `..`/`.`
 * segments. A leading slash is stripped (entries are always joined under the
 * target skill dir, so they cannot escape), and empty paths are rejected.
 */
export function validateZipEntryName(raw: string): boolean {
  const normalized = raw.replace(/\\/g, '/').replace(/^\/+/, '')
  if (normalized === '') return false
  const parts = normalized.split('/').filter(Boolean)
  return !parts.some((part) => part === '..' || part === '.')
}

/**
 * Extract a skill from a zip buffer into `baseDir/<name>/`.
 * @param buffer - the raw zip bytes.
 * @param baseDir - the skill root to write into (user or project root).
 * @param requestedName - optional explicit name; when absent, derived from the
 *   zip's single top-level folder.
 * @returns the imported skill identity.
 */
export async function importSkillZip(buffer: Buffer, baseDir: string, requestedName?: string): Promise<ZipImportResult> {
  const zip = new AdmZip(buffer)
  const entries = zip.getEntries()
  if (entries.length === 0) throw new Error('zip is empty')

  // 1) Validate every entry name (zip-slip guard) and collect file payloads.
  const files: Array<{ name: string; data: Buffer }> = []
  const topDirs = new Set<string>()
  let hasTopLevelSkillMd = false
  for (const entry of entries) {
    if (entry.isDirectory) continue
    const raw = entry.entryName
    if (!validateZipEntryName(raw)) throw new Error(`invalid zip entry: ${raw}`)
    const normalized = raw.replace(/\\/g, '/').replace(/^\/+/, '')
    if (normalized === '') continue
    const parts = normalized.split('/').filter(Boolean)
    if (normalized === 'SKILL.md') hasTopLevelSkillMd = true
    if (parts.length >= 2) topDirs.add(parts[0])
    files.push({ name: normalized, data: entry.getData() })
  }
  if (files.length === 0) throw new Error('zip contains no files')

  // 2) Locate the skill root inside the zip: SKILL.md at the top level, or a
  //    single top-level folder that contains it.
  let prefix = ''
  if (!hasTopLevelSkillMd) {
    if (topDirs.size !== 1) throw new Error('zip must contain SKILL.md at its root or inside a single top-level folder')
    const candidate = [...topDirs][0]
    if (!files.some((f) => f.name.startsWith(candidate + '/'))) throw new Error('zip does not contain SKILL.md')
    prefix = candidate + '/'
  }

  // 3) Resolve the target name: explicit request wins, else the top folder.
  const trimmed = requestedName?.trim() ?? ''
  const name = trimmed !== '' ? trimmed : prefix !== '' ? prefix.replace(/\/$/, '') : ''
  if (!NAME_PATTERN.test(name)) throw new Error('name must be kebab-case (lowercase letters/digits first)')

  // 4) Write everything into baseDir/<name>/ with a final containment check.
  const skillDir = join(baseDir, name)
  const skillPath = join(skillDir, 'SKILL.md')
  await mkdir(baseDir, { recursive: true })
  // Reject when the target skill DIRECTORY already exists (never overwrite).
  if (existsSync(skillDir)) throw new Error(`skill ${name} already exists at ${skillPath}`)
  const rootNorm = normalize(skillDir)
  for (const file of files) {
    const rel = prefix !== '' && file.name.startsWith(prefix) ? file.name.slice(prefix.length) : file.name
    const dest = normalize(join(skillDir, rel))
    if (dest !== rootNorm && !dest.startsWith(rootNorm + sep)) throw new Error(`invalid zip entry: ${file.name}`)
    await mkdir(join(skillDir, rel.split('/').slice(0, -1).join('/')), { recursive: true })
    await writeFile(dest, file.data)
  }
  return { name, skillDir, skillPath }
}
