/**
 * Skill collection unit tests: root scanning, precedence, payload grouping,
 * and content building (filesystem fixtures under a temp dir).
 */
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildPayload, collectSkills, findProjectRoot, projectSkillRoot, userSkillRoot, writeSkillFile, type SkillEntry } from '../src/collect.ts'

const SKILL = (name: string, description: string, extra = ''): string => [
  '---',
  `name: ${name}`,
  `description: ${description}`,
  extra,
  '---',
  '',
  `# ${name}`,
].join('\n')

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'skill-studio-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('collectSkills', () => {
  it('scans project, user and system roots with precedence', async () => {
    // project root
    await mkdir(join(root, 'proj', '.dsh', 'skills', 'same-name'), { recursive: true })
    await writeFile(join(root, 'proj', '.dsh', 'skills', 'same-name', 'SKILL.md'), SKILL('same-name', 'project version'))
    await mkdir(join(root, 'proj', '.agents', 'skills', 'agent-skill'), { recursive: true })
    await writeFile(join(root, 'proj', '.agents', 'skills', 'agent-skill', 'SKILL.md'), SKILL('agent-skill', 'agents version'))
    // user root with a conflicting name (must lose to project)
    await mkdir(join(root, 'home', '.dsh', 'skills', 'same-name'), { recursive: true })
    await writeFile(join(root, 'home', '.dsh', 'skills', 'same-name', 'SKILL.md'), SKILL('same-name', 'user version'))
    await mkdir(join(root, 'home', '.dsh', 'skills', 'user-skill'), { recursive: true })
    await writeFile(join(root, 'home', '.dsh', 'skills', 'user-skill', 'SKILL.md'), SKILL('user-skill', 'user only'))
    // system root (read-only) with a unique skill
    await mkdir(join(root, 'sys', 'cordis', 'skills', 'system-skill'), { recursive: true })
    await writeFile(join(root, 'sys', 'cordis', 'skills', 'system-skill', 'SKILL.md'), SKILL('system-skill', 'system only'))

    const skills = await collectSkills({
      projectRoots: [join(root, 'proj')],
      dshHome: join(root, 'home', '.dsh'),
      agentsHome: join(root, 'home', '.agents'),
      systemSkillDirs: [join(root, 'sys', 'cordis', 'skills')],
    })

    const byName = new Map(skills.map((skill) => [skill.name, skill]))
    expect(byName.get('same-name')?.description).toBe('project version') // project wins
    expect(byName.get('same-name')?.sourceKey).toBe('project-dsh')
    expect(byName.get('agent-skill')?.sourceKey).toBe('project-agents')
    expect(byName.get('user-skill')?.sourceKey).toBe('user-dsh')
    expect(byName.get('system-skill')?.sourceKey).toBe('system')
    expect(byName.get('system-skill')?.editable).toBe(false)
    expect(byName.get('user-skill')?.editable).toBe(true)
  })

  it('skips directories without SKILL.md and invalid names', async () => {
    await mkdir(join(root, 'proj', '.dsh', 'skills', 'no-file'), { recursive: true })
    await mkdir(join(root, 'proj', '.dsh', 'skills', 'Bad_Name'), { recursive: true })
    await writeFile(join(root, 'proj', '.dsh', 'skills', 'Bad_Name', 'SKILL.md'), SKILL('Bad_Name', 'invalid'))
    const skills = await collectSkills({ projectRoots: [join(root, 'proj')], dshHome: join(root, 'h', '.dsh'), agentsHome: join(root, 'h', '.agents') })
    expect(skills).toEqual([])
  })

  it('honors disable-model-invocation', async () => {
    await mkdir(join(root, 'proj', '.dsh', 'skills', 'off-skill'), { recursive: true })
    await writeFile(join(root, 'proj', '.dsh', 'skills', 'off-skill', 'SKILL.md'), SKILL('off-skill', 'off', 'disable-model-invocation: true'))
    const skills = await collectSkills({ projectRoots: [join(root, 'proj')], dshHome: join(root, 'h', '.dsh'), agentsHome: join(root, 'h', '.agents') })
    expect(skills[0].modelInvocable).toBe(false)
  })
})

describe('buildPayload', () => {
  it('groups by level in display order and sorts by name', () => {
    const skills: SkillEntry[] = [
      { name: 'b', description: '', level: 'user', sourceKey: 'user-dsh', editable: true, modelInvocable: true, userInvocable: true },
      { name: 'a', description: '', level: 'user', sourceKey: 'user-agents', editable: true, modelInvocable: true, userInvocable: true },
      { name: 'z', description: '', level: 'system', sourceKey: 'system', editable: false, modelInvocable: true, userInvocable: true },
      { name: 'p', description: '', level: 'project', sourceKey: 'project-dsh', editable: true, modelInvocable: true, userInvocable: true },
    ]
    const payload = buildPayload(skills, '/tmp', ['/tmp'])
    expect(payload.groups.map((g) => g.key)).toEqual(['project', 'user', 'system'])
    expect(payload.groups[1].skills.map((s) => s.name)).toEqual(['a', 'b'])
  })
})

describe('writeSkillFile / roots', () => {
  it('writes a standard SKILL.md and rejects duplicates', async () => {
    const base = join(root, 'proj', '.dsh', 'skills')
    const target = await writeSkillFile(base, 'new-skill', 'A new skill', 'When needed', '# Body')
    expect(target).toBe(join(base, 'new-skill', 'SKILL.md'))
    await expect(writeSkillFile(base, 'new-skill', 'dup', undefined, 'x')).rejects.toThrow(/already exists/)
  })

  it('computes the official roots', () => {
    expect(userSkillRoot('/home/u/.dsh')).toBe('/home/u/.dsh/skills')
    expect(projectSkillRoot('/repo')).toBe(`/repo${sep}.dsh${sep}skills`)
  })

  it('finds the nearest .git ancestor', async () => {
    await mkdir(join(root, 'gitrepo', '.git'), { recursive: true })
    await mkdir(join(root, 'gitrepo', 'sub'), { recursive: true })
    expect(findProjectRoot(join(root, 'gitrepo', 'sub'))).toBe(join(root, 'gitrepo'))
  })
})
