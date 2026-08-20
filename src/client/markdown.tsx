/**
 * Zero-dependency mini Markdown renderer for SKILL.md preview (browser half).
 * Renders React elements (never dangerouslySetInnerHTML): headings, fenced
 * code, lists, blockquotes, hr, paragraphs, and inline code/bold/italic/links
 * with sanitized hrefs.
 */
import React, { type ReactNode } from 'react'

/** Inline parsing: code / bold / italic / links, text auto-escaped by React. */
export function inlineMarkdown(text: string, keyBase: number): ReactNode[] {
  const out: ReactNode[] = []
  const re = /(`[^`]+`)|(\*\*[^*\n]+\*\*)|(\*[^*\n]+\*)|(\[[^\]]+\]\([^)]+\))/g
  let last = 0
  let m: RegExpExecArray | null
  let k = keyBase
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index))
    const key = k++
    if (m[1] !== undefined) {
      out.push(React.createElement('code', { key }, m[1].slice(1, -1)))
    } else if (m[2] !== undefined) {
      out.push(React.createElement('strong', { key }, m[2].slice(2, -2)))
    } else if (m[3] !== undefined) {
      out.push(React.createElement('em', { key }, m[3].slice(1, -1)))
    } else if (m[4] !== undefined) {
      const mm = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(m[4])
      const href = mm![2]
      const safe = /^(https?:|mailto:|#)/.test(href) ? href : '#'
      out.push(React.createElement('a', { key, href: safe, target: '_blank', rel: 'noreferrer' }, mm![1]))
    }
    last = m.index + m[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out.length > 0 ? out : [text]
}

/** Block parsing: returns an array of React elements for the whole document. */
export function renderMarkdown(source: string): ReactNode[] {
  const lines = String(source).replace(/\r\n/g, '\n').split('\n')
  const out: ReactNode[] = []
  let i = 0
  let k = 0
  let listKind: 'ul' | 'ol' | null = null
  let listItems: ReactNode[] = []
  const flushList = (): void => {
    if (listItems.length === 0) return
    out.push(React.createElement(listKind === 'ol' ? 'ol' : 'ul', { key: k++ }, listItems.map((it, idx) => React.createElement('li', { key: idx }, it))))
    listItems = []
    listKind = null
  }
  while (i < lines.length) {
    const line = lines[i]
    const fence = /^```(.*)$/.exec(line)
    if (fence !== null) {
      flushList()
      const buf: string[] = []
      i += 1
      while (i < lines.length && !/^```\s*$/.test(lines[i])) { buf.push(lines[i]); i += 1 }
      i += 1
      out.push(React.createElement('pre', { key: k++ }, React.createElement('code', { key: 0 }, buf.join('\n'))))
      continue
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line)
    if (h !== null) {
      flushList()
      out.push(React.createElement(`h${h[1].length}` as 'h1', { key: k++ }, inlineMarkdown(h[2], k * 1000)))
      i += 1
      continue
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      flushList()
      out.push(React.createElement('hr', { key: k++ }))
      i += 1
      continue
    }
    const ul = /^\s*[-*+]\s+(.*)$/.exec(line)
    if (ul !== null) {
      if (listKind !== 'ul') { flushList(); listKind = 'ul' }
      listItems.push(inlineMarkdown(ul[1], k * 1000))
      i += 1
      continue
    }
    const ol = /^\s*\d+[.)]\s+(.*)$/.exec(line)
    if (ol !== null) {
      if (listKind !== 'ol') { flushList(); listKind = 'ol' }
      listItems.push(inlineMarkdown(ol[1], k * 1000))
      i += 1
      continue
    }
    const bq = /^\s*>\s?(.*)$/.exec(line)
    if (bq !== null) {
      flushList()
      const buf: string[] = [bq[1]]
      i += 1
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) { buf.push(lines[i].replace(/^\s*>\s?/, '')); i += 1 }
      out.push(React.createElement('blockquote', { key: k++ }, renderMarkdown(buf.join('\n'))))
      continue
    }
    flushList()
    if (line.trim() === '') { i += 1; continue }
    const para: string[] = [line]
    i += 1
    while (i < lines.length && lines[i].trim() !== '' && !/^(#{1,6})\s/.test(lines[i]) && !/^```/.test(lines[i])) { para.push(lines[i]); i += 1 }
    out.push(React.createElement('p', { key: k++ }, inlineMarkdown(para.join(' '), k * 1000)))
  }
  flushList()
  return out
}

/** Strip a leading YAML frontmatter block (no-op when absent). */
export function stripFrontmatter(content: string): string {
  return String(content).replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '')
}
