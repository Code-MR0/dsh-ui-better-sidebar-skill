/**
 * Frontmatter parse/rewrite unit tests (zero-dependency behavior lock).
 */
import { describe, expect, it } from 'vitest'
import { parseFrontmatter, parseYamlBool, rewriteFrontmatter } from '../src/frontmatter.ts'

describe('parseYamlBool', () => {
  it('parses the common YAML boolean spellings', () => {
    expect(parseYamlBool('true')).toBe(true)
    expect(parseYamlBool('yes')).toBe(true)
    expect(parseYamlBool('ON')).toBe(true)
    expect(parseYamlBool('1')).toBe(true)
    expect(parseYamlBool('false')).toBe(false)
    expect(parseYamlBool('no')).toBe(false)
    expect(parseYamlBool('0')).toBe(false)
    expect(parseYamlBool('maybe')).toBeUndefined()
  })
})

describe('parseFrontmatter', () => {
  it('parses scalar fields', () => {
    const fm = parseFrontmatter([
      '---',
      'name: my-skill',
      'description: Does things',
      'whenToUse: When needed',
      'disable-model-invocation: true',
      'user-invocable: false',
      '---',
      '',
      '# Body',
    ].join('\n'))
    expect(fm.name).toBe('my-skill')
    expect(fm.description).toBe('Does things')
    expect(fm.whenToUse).toBe('When needed')
    expect(fm.disableModelInvocation).toBe(true)
    expect(fm.userInvocable).toBe(false)
  })

  it('parses block scalars', () => {
    const fm = parseFrontmatter([
      '---',
      'description: |',
      '  line one',
      '  line two',
      '---',
    ].join('\n'))
    expect(fm.description).toBe('line one line two')
  })

  it('returns an empty object without frontmatter', () => {
    expect(parseFrontmatter('# just a body')).toEqual({})
  })

  it('parses quoted values', () => {
    const fm = parseFrontmatter("---\ndescription: 'a: quoted value'\n---\n")
    expect(fm.description).toBe('a: quoted value')
  })
})

describe('rewriteFrontmatter', () => {
  it('replaces an existing field and preserves the body', () => {
    const next = rewriteFrontmatter('---\nname: x\ndisable-model-invocation: true\n---\n# Body\n', 'disable-model-invocation', false)
    expect(parseFrontmatter(next).disableModelInvocation).toBe(false)
    expect(next).toContain('# Body')
  })

  it('appends a missing field', () => {
    const next = rewriteFrontmatter('---\nname: x\n---\nBody\n', 'disable-model-invocation', true)
    const fm = parseFrontmatter(next)
    expect(fm.disableModelInvocation).toBe(true)
    expect(next).toContain('name: x')
    expect(next).toContain('Body')
  })

  it('throws when there is no frontmatter', () => {
    expect(() => rewriteFrontmatter('# no frontmatter\n', 'x', true)).toThrow()
  })
})
