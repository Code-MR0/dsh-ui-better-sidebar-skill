/**
 * ZIP import unit tests: extraction, name derivation, zip-slip rejection,
 * and layout normalization (top-level SKILL.md vs single top folder).
 */
import AdmZip from 'adm-zip'
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { importSkillZip, validateZipEntryName } from '../src/importZip.ts'

let base: string

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'skill-zip-'))
})

afterEach(async () => {
  await rm(base, { recursive: true, force: true })
})

/** Build a zip buffer with the given relative files. */
function makeZip(files: Record<string, string>): Buffer {
  const zip = new AdmZip()
  for (const [name, content] of Object.entries(files)) zip.addFile(name, Buffer.from(content, 'utf8'))
  return zip.toBuffer()
}

describe('importSkillZip', () => {
  it('imports a zip with SKILL.md at the top level', async () => {
    const buffer = makeZip({
      'SKILL.md': '---\nname: demo\n---\n# Demo\n',
      'notes.txt': 'hello',
      'assets/logo.txt': 'logo',
    })
    const result = await importSkillZip(buffer, base, 'demo-skill')
    expect(result.name).toBe('demo-skill')
    expect(existsSync(join(base, 'demo-skill', 'SKILL.md'))).toBe(true)
    expect(await readFile(join(base, 'demo-skill', 'assets', 'logo.txt'), 'utf8')).toBe('logo')
    expect(result.skillPath).toBe(join(base, 'demo-skill', 'SKILL.md'))
  })

  it('derives the name from a single top-level folder and strips it', async () => {
    const buffer = makeZip({
      'my-folder/SKILL.md': '---\nname: x\n---\n# X\n',
      'my-folder/ref.md': '# Ref\n',
    })
    const result = await importSkillZip(buffer, base, '')
    expect(result.name).toBe('my-folder')
    expect(existsSync(join(base, 'my-folder', 'SKILL.md'))).toBe(true)
    expect(await readFile(join(base, 'my-folder', 'ref.md'), 'utf8')).toBe('# Ref\n')
  })

  it('rejects a zip without SKILL.md', async () => {
    const buffer = makeZip({ 'readme.txt': 'no skill here' })
    await expect(importSkillZip(buffer, base, 'x')).rejects.toThrow(/SKILL\.md/)
  })

  it('rejects ambiguous zips (multiple top folders, no SKILL.md at root)', async () => {
    const buffer = makeZip({
      'a/SKILL.md': '---\nname: a\n---\n# A\n',
      'b/SKILL.md': '---\nname: b\n---\n# B\n',
    })
    await expect(importSkillZip(buffer, base, 'x')).rejects.toThrow(/single top-level folder/)
  })

  it('rejects path-traversal entry names (zip-slip guard)', () => {
    expect(validateZipEntryName('../evil.txt')).toBe(false)
    expect(validateZipEntryName('a/../../evil.txt')).toBe(false)
    expect(validateZipEntryName('a/./b.txt')).toBe(false)
    expect(validateZipEntryName('a/..')).toBe(false)
    expect(validateZipEntryName('')).toBe(false)
    expect(validateZipEntryName('SKILL.md')).toBe(true)
    expect(validateZipEntryName('/etc/passwd')).toBe(true) // stripped to relative, joined under the target dir
    expect(validateZipEntryName('assets/logo.txt')).toBe(true)
    expect(validateZipEntryName('a//b.txt')).toBe(true)
  })

  it('rejects an invalid explicit name', async () => {
    const buffer = makeZip({ 'SKILL.md': '# X\n' })
    await expect(importSkillZip(buffer, base, 'Bad_Name')).rejects.toThrow(/kebab-case/)
  })

  it('rejects an already-existing skill directory', async () => {
    await mkdir(join(base, 'demo'), { recursive: true })
    const buffer = makeZip({ 'SKILL.md': '# X\n' })
    await expect(importSkillZip(buffer, base, 'demo')).rejects.toThrow(/already exists/)
  })
})
