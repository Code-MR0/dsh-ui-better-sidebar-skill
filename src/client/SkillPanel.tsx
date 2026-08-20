/**
 * Skill studio panel (browser half): the better-sidebar tab content.
 * Two columns: a merged explorer (searchable grouped skill list, each skill
 * expanding into its lazy collapsible file tree — VSCode-style like
 * better-sidebar's Files) | preview/editor of the selected file (SKILL.md and
 * every other file in the skill folder). Manage actions: create (user/project
 * root), delete to .trash, enable/disable model invocation (SKILL.md
 * frontmatter).
 */
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { IconCodeOutline16, IconFolderClose16, IconFolderOpen16 } from '@deepseek-ai/dsh-client-ui-primitives'
import { SkillApi, type ListPayload, type SkillEntry } from './api.ts'
import { renderMarkdown, stripFrontmatter } from './markdown.tsx'
import css from './skill-panel.module.css'

/** Better-sidebar tab props (structural mirror; no hard dependency). */
export interface SkillStudioTabProps {
  ctx: unknown
  store: unknown
  scope: { sessionId: string; cwd?: string }
  tab: { id: string; type: string; title: string; path?: string }
  visible: boolean
}

/** Panel props. */
export interface SkillPanelProps {
  api: SkillApi
  scope: { sessionId: string; cwd?: string }
}

/** One directory listing row (a single tree level). */
interface DirEntry {
  name: string
  type: 'directory' | 'file'
  size: number | null
}

/** Matches a skill against the search query (name + description). */
function matchesQuery(skill: SkillEntry, query: string): boolean {
  if (query === '') return true
  const q = query.toLowerCase()
  return skill.name.toLowerCase().includes(q) || skill.description.toLowerCase().includes(q)
}

/** Human-readable byte size. */
function fmtSize(bytes: number | null | undefined): string {
  const n = Number(bytes) || 0
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${n} B`
}

/** Basename of a slash path. */
function basenameOf(path: string): string {
  const i = path.lastIndexOf('/')
  return i === -1 ? path : path.slice(i + 1)
}

/** Parent directory of a file path. */
function dirnameOf(path: string): string {
  const i = path.lastIndexOf('/')
  return i <= 0 ? '/' : path.slice(0, i)
}

/** Left-column width as a PERCENTAGE of the panel body; persisted on drag end. */
const LAYOUT_KEY = 'skill-studio.layout.v3'
const DEFAULT_LAYOUT = { list: 32 }
const WIDTH_RANGE: readonly [number, number] = [18, 55]

function clampWidth(value: number, range: readonly [number, number]): number {
  return Math.min(range[1], Math.max(range[0], value))
}

interface ColumnLayout {
  list: number
}

function loadLayout(): ColumnLayout {
  try {
    if (typeof localStorage === 'undefined') return { ...DEFAULT_LAYOUT }
    const raw = localStorage.getItem(LAYOUT_KEY)
    if (raw === null) return { ...DEFAULT_LAYOUT }
    const parsed = JSON.parse(raw) as { list?: unknown }
    return {
      list: typeof parsed.list === 'number' ? clampWidth(parsed.list, WIDTH_RANGE) : DEFAULT_LAYOUT.list,
    }
  } catch {
    return { ...DEFAULT_LAYOUT }
  }
}

/** Vertical drag handle between two columns (pointer-capture based). */
function Splitter(props: { onDelta: (dx: number) => void; onDragEnd?: () => void }): React.JSX.Element {
  const { onDelta, onDragEnd } = props
  const [active, setActive] = useState(false)
  const dragging = useRef(false)
  const startX = useRef(0)

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    event.preventDefault()
    dragging.current = true
    startX.current = event.clientX
    setActive(true)
    if (typeof document !== 'undefined') document.body.style.userSelect = 'none'
    const move = (ev: PointerEvent): void => {
      if (!dragging.current) return
      onDelta(ev.clientX - startX.current)
      startX.current = ev.clientX
    }
    const up = (): void => {
      dragging.current = false
      setActive(false)
      if (typeof document !== 'undefined') document.body.style.userSelect = ''
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      onDragEnd?.()
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      className={`${css.splitter}${active ? ` ${css.splitterActive}` : ''}`}
      onPointerDown={onPointerDown}
    />
  )
}

/** Create-skill modal form. */
function CreateForm(props: { cwd?: string; projectRoot: string; api: SkillApi; onCreated: () => void; onCancel: () => void }): React.JSX.Element {
  const { cwd, projectRoot, api, onCreated, onCancel } = props
  const [root, setRoot] = useState<'project' | 'user'>('project')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [whenToUse, setWhenToUse] = useState('')
  const [content, setContent] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | undefined>(undefined)

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    setBusy(true)
    setErr(undefined)
    try {
      await api.create({ root, name, description, whenToUse, content, cwd: cwd ?? '' })
      onCreated()
    } catch (error) {
      setErr(error instanceof Error ? error.message : String(error))
      setBusy(false)
    }
  }

  const field = (label: string, node: React.ReactNode): React.JSX.Element => (
    <div className={css.field}>
      <label>{label}</label>
      {node}
    </div>
  )

  return (
    <div className={css.modal}>
      <form className={css.modalCard} onSubmit={submit}>
        <h3>新建 skill</h3>
        {field('写入位置', (
          <select value={root} onChange={(e) => setRoot(e.target.value as 'project' | 'user')}>
            <option value="project">项目：{(projectRoot || cwd || '当前工作区')}/.dsh/skills</option>
            <option value="user">全局：~/.dsh/skills（所有项目可用）</option>
          </select>
        ))}
        {field('名称（小写字母/数字/连字符）', (
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="my-skill-name" />
        ))}
        {field('描述', (
          <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="一句话说明这个 skill 做什么" />
        ))}
        {field('适用场景（whenToUse，可选）', (
          <input value={whenToUse} onChange={(e) => setWhenToUse(e.target.value)} />
        ))}
        {field('正文内容（Markdown）', (
          <textarea value={content} onChange={(e) => setContent(e.target.value)} placeholder={'# 说明\n\n这个 skill 教 agent 如何……'} />
        ))}
        {err === undefined ? null : <div className={css.statusError}>{err}</div>}
        <div className={css.modalActions}>
          <button type="button" className={css.btn} onClick={onCancel} disabled={busy}>取消</button>
          <button type="submit" className={`${css.btn} ${css.btnPrimary}`} disabled={busy || name.trim() === '' || description.trim() === ''}>
            {busy ? '创建中…' : '创建'}
          </button>
        </div>
      </form>
    </div>
  )
}

/** One skill card in the merged explorer; clicking toggles its file tree. */
function SkillCard(props: { skill: SkillEntry; active: boolean; open: boolean; onClick: () => void }): React.JSX.Element {
  const { skill, active, open, onClick } = props
  return (
    <div className={`${css.item}${active ? ` ${css.itemActive}` : ''}`} onClick={onClick}>
      <div className={css.itemName}>
        <span className={css.itemChevron}>{open ? '▾' : '▸'}</span>
        {skill.name}
        {skill.editable === false ? <span className={css.badge}>只读</span> : null}
        {skill.modelInvocable === false ? <span className={`${css.badge} ${css.badgeOff}`}>停用</span> : null}
      </div>
      <div className={css.itemDesc}>{skill.description}</div>
    </div>
  )
}

/** The main panel: merged skill explorer | preview/editor. */
export function SkillPanel(props: SkillPanelProps): React.JSX.Element {
  const { api, scope } = props
  const cwd = scope.cwd !== undefined && scope.cwd !== '' ? scope.cwd : undefined

  const [groups, setGroups] = useState<ListPayload['groups']>([])
  const [projectRoot, setProjectRoot] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | undefined>(undefined)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<SkillEntry | undefined>(undefined)
  /** Skills whose file tree is expanded (by skill name). */
  const [expandedSkills, setExpandedSkills] = useState<string[]>([])
  /** Per-directory level cache: entries, or a loading/error marker. */
  const [levels, setLevels] = useState<Record<string, DirEntry[] | 'loading' | 'error'>>({})
  /** Expanded directory paths inside the skill trees (absolute). */
  const [expandedDirs, setExpandedDirs] = useState<string[]>([])
  /** Currently open file (absolute path). */
  const [currentFile, setCurrentFile] = useState<string | undefined>(undefined)
  const [fileDetail, setFileDetail] = useState<{ size: number; content?: string; binary: boolean; tooLarge: boolean; editable: boolean } | undefined>(undefined)
  const [mode, setMode] = useState<'preview' | 'edit'>('preview')
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [busy, setBusy] = useState(false)
  const [creating, setCreating] = useState(false)
  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; text: string } | undefined>(undefined)

  const [widths, setWidths] = useState<ColumnLayout>(loadLayout)
  const widthsRef = useRef(widths)
  useEffect(() => {
    widthsRef.current = widths
  }, [widths])

  /** Track the body's pixel width so drag deltas convert to percentages. */
  const bodyRef = useRef<HTMLDivElement>(null)
  const [bodyWidth, setBodyWidth] = useState(0)
  useEffect(() => {
    const el = bodyRef.current
    if (el === null) return
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) setBodyWidth(entry.contentRect.width)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  /** Persist the LATEST column width only (called on drag end). */
  const persistWidths = (): void => {
    try {
      if (typeof localStorage !== 'undefined') localStorage.setItem(LAYOUT_KEY, JSON.stringify(widthsRef.current))
    } catch {
      // ignore storage failures
    }
  }
  const resizeList = (dx: number): void => {
    if (bodyWidth <= 0) return
    setWidths((prev) => ({ ...prev, list: clampWidth(prev.list + (dx / bodyWidth) * 100, WIDTH_RANGE) }))
  }

  const refresh = useCallback(async (): Promise<void> => {
    try {
      setLoading(true)
      const data = await api.list(cwd)
      setGroups(data.groups)
      setProjectRoot(data.projectRoots[0] ?? '')
      setError(undefined)
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
    } finally {
      setLoading(false)
    }
  }, [api, cwd])

  useEffect(() => {
    void refresh()
  }, [refresh])

  /** Load one directory level into the cache (idempotent). */
  const loadDir = useCallback(async (dir: string): Promise<DirEntry[] | undefined> => {
    setLevels((prev) => (prev[dir] === undefined ? { ...prev, [dir]: 'loading' as const } : prev))
    try {
      const data = await api.listDir(dir, cwd)
      setLevels((prev) => ({ ...prev, [dir]: data.entries }))
      return data.entries
    } catch (err) {
      setLevels((prev) => ({ ...prev, [dir]: 'error' as const }))
      setStatus({ kind: 'error', text: err instanceof Error ? err.message : String(err) })
      return undefined
    }
  }, [api, cwd])

  const openFile = useCallback(async (full: string): Promise<void> => {
    setCurrentFile(full)
    setMode('preview')
    setFileDetail(undefined)
    setStatus(undefined)
    try {
      const data = await api.readFile(full, cwd)
      setFileDetail(data)
      setDraft(typeof data.content === 'string' ? data.content : '')
    } catch (err) {
      setStatus({ kind: 'error', text: err instanceof Error ? err.message : String(err) })
    }
  }, [api, cwd])

  const toggleDir = (dir: string): void => {
    setExpandedDirs((prev) => {
      if (prev.includes(dir)) return prev.filter((d) => d !== dir)
      void loadDir(dir)
      return [...prev, dir]
    })
  }

  /** Expand/collapse a skill: toggles its file tree and selects it. */
  const toggleSkill = async (skill: SkillEntry): Promise<void> => {
    if (skill.path === undefined) return
    const root = dirnameOf(skill.path)
    if (expandedSkills.includes(skill.name)) {
      setExpandedSkills((prev) => prev.filter((n) => n !== skill.name))
      setExpandedDirs((prev) => prev.filter((d) => d !== root && !d.startsWith(root + '/')))
      if (selected?.name === skill.name) {
        setSelected(undefined)
        setCurrentFile(undefined)
        setFileDetail(undefined)
        setMode('preview')
      }
      return
    }
    setSelected(skill)
    setExpandedSkills((prev) => [...prev, skill.name])
    setStatus(undefined)
    setCurrentFile(undefined)
    setFileDetail(undefined)
    setMode('preview')
    const entries = await loadDir(root)
    const first = entries?.find((e) => e.type === 'file' && e.name === 'SKILL.md')
      ?? entries?.find((e) => e.type === 'file')
    if (first !== undefined) await openFile(`${root}/${first.name}`)
  }

  const save = async (): Promise<void> => {
    if (currentFile === undefined) return
    setSaving(true)
    setStatus(undefined)
    try {
      await api.write(currentFile, draft, cwd)
      const data = await api.readFile(currentFile, cwd)
      setFileDetail(data)
      setDraft(typeof data.content === 'string' ? data.content : '')
      setMode('preview')
      setStatus({ kind: 'ok', text: `已保存 ${basenameOf(currentFile)}` })
    } catch (error) {
      setStatus({ kind: 'error', text: error instanceof Error ? error.message : String(error) })
    } finally {
      setSaving(false)
    }
  }

  const toggleEnabled = async (): Promise<void> => {
    if (selected?.path === undefined) return
    setBusy(true)
    setStatus(undefined)
    try {
      const data = await api.read(selected.path, cwd)
      const disabled = data.frontmatter['disableModelInvocation'] === true
      await api.setEnabled(selected.path, disabled, cwd)
      await refresh()
      setStatus({ kind: 'ok', text: disabled ? '已启用模型调用' : '已禁用模型调用' })
    } catch (error) {
      setStatus({ kind: 'error', text: error instanceof Error ? error.message : String(error) })
    } finally {
      setBusy(false)
    }
  }

  const remove = async (): Promise<void> => {
    if (selected?.path === undefined) return
    if (typeof window !== 'undefined' && !window.confirm(`删除 skill「${selected.name}」？文件将移入 .trash（可恢复）。`)) return
    setBusy(true)
    setStatus(undefined)
    try {
      await api.remove(selected.path, cwd)
      setSelected(undefined)
      setExpandedSkills((prev) => prev.filter((n) => n !== selected.name))
      setExpandedDirs([])
      setCurrentFile(undefined)
      setFileDetail(undefined)
      setMode('preview')
      await refresh()
      setStatus({ kind: 'ok', text: '已删除（移入 .trash）' })
    } catch (error) {
      setStatus({ kind: 'error', text: error instanceof Error ? error.message : String(error) })
    } finally {
      setBusy(false)
    }
  }

  const skillDisabled = selected?.modelInvocable === false
  const visibleGroups = groups
    .map((group) => ({ ...group, skills: group.skills.filter((skill) => matchesQuery(skill, query)) }))
    .filter((group) => group.skills.length > 0)

  /** Lazy collapsible file-tree level (better-sidebar Files style). */
  const renderLevel = (dir: string, depth: number): React.JSX.Element => {
    const level = levels[dir]
    if (level === undefined || level === 'loading') {
      return <div className={css.explorerRow} style={{ paddingLeft: depth * 22 + 6 }}>加载中…</div>
    }
    if (level === 'error') {
      return <div className={`${css.explorerRow} ${css.explorerError}`} style={{ paddingLeft: depth * 22 + 6 }}>加载失败</div>
    }
    return (
      <>
        {level.map((entry) => {
          const full = `${dir}/${entry.name}`
          if (entry.type === 'directory') {
            const open = expandedDirs.includes(full)
            return (
              <div key={full}>
                <div
                  role="button"
                  tabIndex={0}
                  className={`${css.explorerRow} ${css.explorerDir}`}
                  style={{ paddingLeft: depth * 22 + 6 }}
                  onClick={() => toggleDir(full)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      toggleDir(full)
                    }
                  }}
                >
                  {open ? <IconFolderOpen16 size={14} /> : <IconFolderClose16 size={14} />}
                  <span className={css.explorerName}>{entry.name}</span>
                </div>
                {open && renderLevel(full, depth + 1)}
              </div>
            )
          }
          return (
            <div
              key={full}
              role="button"
              tabIndex={0}
              className={`${css.explorerRow}${currentFile === full ? ` ${css.explorerRowActive}` : ''}`}
              style={{ paddingLeft: depth * 22 + 6 }}
              title={full}
              onClick={() => void openFile(full)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  void openFile(full)
                }
              }}
            >
              <IconCodeOutline16 size={14} />
              <span className={css.explorerName}>{entry.name}</span>
              {entry.size === null ? null : <span className={css.explorerSize}>{fmtSize(entry.size)}</span>}
            </div>
          )
        })}
      </>
    )
  }

  // -------- merged explorer column: skills + their nested file trees --------
  const listPane = (
    <div className={css.list} style={{ width: `${widths.list}%` }}>
      <input className={css.search} placeholder="搜索 skill…" value={query} onChange={(e) => setQuery(e.target.value)} />
      {loading ? <div className={css.empty}>加载中…</div>
        : error !== undefined ? <div className={css.empty}>{error}</div>
        : visibleGroups.length === 0 ? <div className={css.empty}>未发现 skill</div>
        : visibleGroups.map((group) => (
          <div key={group.key}>
            <div className={css.groupTitle}>{group.title}</div>
            <div className={css.groupHint}>{group.hint}</div>
            {group.skills.map((skill) => {
              const open = skill.path !== undefined && expandedSkills.includes(skill.name)
              const root = skill.path !== undefined ? dirnameOf(skill.path) : ''
              return (
                <div key={skill.name}>
                  <SkillCard
                    skill={skill}
                    active={selected?.name === skill.name}
                    open={open}
                    onClick={() => void toggleSkill(skill)}
                  />
                  {open && root !== '' && levels[root] !== undefined && renderLevel(root, 1)}
                </div>
              )
            })}
          </div>
        ))}
    </div>
  )

  // -------- preview or editor of the current file --------
  let detailPane: React.JSX.Element
  if (currentFile === undefined || fileDetail === undefined) {
    detailPane = <div className={css.empty}>{selected === undefined ? '展开左侧 skill 查看文件' : '加载中…'}</div>
  } else if (fileDetail.binary === true) {
    detailPane = <div className={css.empty}>二进制文件（{fmtSize(fileDetail.size)}），无法预览</div>
  } else if (fileDetail.tooLarge === true) {
    detailPane = <div className={css.empty}>文件过大（{fmtSize(fileDetail.size)}），仅展示大小</div>
  } else {
    const head = (
      <div className={css.detailHead}>
        <div className={css.detailTitle}>
          {basenameOf(currentFile)}
          {fileDetail.editable === false ? <span className={css.badge}>只读</span> : null}
          <span className={css.spacer} />
        </div>
        <div className={css.detailMeta}>{currentFile}</div>
      </div>
    )
    const body = mode === 'edit'
      ? (
        <div className={css.editor}>
          <textarea className={css.textarea} value={draft} onChange={(e) => setDraft(e.target.value)} spellCheck={false} />
        </div>
      )
      : /\.md$/i.test(currentFile)
        ? <div className={css.preview}>{renderMarkdown(stripFrontmatter(draft))}</div>
        : <div className={css.preview}><pre className={css.plain}>{draft}</pre></div>
    // The detail wrapper is a real flex column child (a Fragment would make
    // head/body siblings of the list and squeeze the preview).
    detailPane = <div className={css.detail}>{head}{body}</div>
  }

  const canEdit = currentFile !== undefined && fileDetail !== undefined && fileDetail.editable === true && fileDetail.binary !== true && fileDetail.tooLarge !== true
  const toolbar = (
    <div className={css.toolbar}>
      <button className={`${css.btn} ${css.btnPrimary}`} onClick={() => setCreating(true)}>+ 新建</button>
      <button className={css.btn} onClick={() => void refresh()} disabled={loading}>刷新</button>
      {selected !== undefined && canEdit && mode === 'preview'
        ? <button className={css.btn} onClick={() => setMode('edit')} disabled={busy}>编辑</button> : null}
      {selected !== undefined && canEdit && mode === 'edit'
        ? <button className={`${css.btn} ${css.btnPrimary}`} onClick={() => void save()} disabled={saving || busy}>{saving ? '保存中…' : '保存'}</button> : null}
      {selected !== undefined && canEdit && mode === 'edit'
        ? <button className={css.btn} onClick={() => { setMode('preview'); setDraft(fileDetail.content ?? '') }} disabled={busy}>取消</button> : null}
      {selected !== undefined && selected.editable
        ? <button className={css.btn} onClick={() => void toggleEnabled()} disabled={busy}>{skillDisabled === true ? '启用模型调用' : '禁用模型调用'}</button> : null}
      {selected !== undefined && selected.editable
        ? <button className={`${css.btn} ${css.btnDanger}`} onClick={() => void remove()} disabled={busy}>删除</button> : null}
      <span className={css.spacer} />
      {projectRoot !== '' ? <span className={css.detailMeta}>{projectRoot}</span> : null}
    </div>
  )

  const statusClass = status === undefined ? css.status : status.kind === 'error' ? css.statusError : css.statusOk
  const statusText = status?.text ?? '就绪'

  return (
    <div className={css.root}>
      {toolbar}
      <div className={css.body} ref={bodyRef}>
        {listPane}
        <Splitter onDelta={resizeList} onDragEnd={persistWidths} />
        {detailPane}
      </div>
      <div className={statusClass}>{statusText}</div>
      {creating
        ? <CreateForm
            cwd={cwd}
            projectRoot={projectRoot}
            api={api}
            onCreated={() => { setCreating(false); void refresh() }}
            onCancel={() => setCreating(false)}
          />
        : null}
    </div>
  )
}
