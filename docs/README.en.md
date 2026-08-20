# @mhw12138/dsh-ui-better-sidebar-skill

<div align="center">
  <b style="font-size: 1.15em;">A skill workbench for the DSH Web GUI: browse, preview, edit and manage your global and project skills</b><br /><br />
  <a href="https://github.com/Code-MR0/dsh-ui-better-sidebar-skill"><img alt="GitHub" src="https://img.shields.io/github/stars/Code-MR0/dsh-ui-better-sidebar-skill?style=flat" /></a>
  <a href="../LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/License-MIT-yellow.svg" /></a>
  <img alt="version" src="https://img.shields.io/badge/version-0.1.0-blue" />
</div>

<div align="center">
  🌏 <a href="../README.md"><b>中文</b></a>
</div>

<div align="center">
  <img alt="Skill workbench overview" src="../screenshots/overview.png" width="720" />
</div>

## ✨ Features

- **🗂️ Explorer** — browse every skill grouped by source: project (`.dsh/skills` / `.agents/skills`), global user (`~/.dsh/skills` / `~/.agents/skills`), and read-only system bundled skills; search included.
- **🌳 Lazy file tree** — expand a skill to reveal its whole directory (`SKILL.md` plus every file); subdirectories load on demand, one level at a time, collapsible — styled after dsh-better-sidebar's Files explorer.
- **📖 Preview** — Markdown rendering (headings / lists / code blocks / quotes / links), plain text, with binary and oversized-file detection.
- **✏️ Edit** — inline editor rewrites any text file (including the `SKILL.md` frontmatter) with an atomic save.
- **➕ Manage** — create (project root or `~/.dsh/skills`, generating a standard SKILL.md), delete (moved into a recoverable `.trash`), and enable/disable model invocation (rewrites `disable-model-invocation`).
- **↔️ Adjustable layout** — the explorer column and the content pane resize by percentage drag; the latest width is remembered.

## 🔌 Service-based integration

- The「技能管理」tab is registered through the external [dsh-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar) plugin's `ctx.betterSidebar.registerTab` — no DOM injection.
- Data comes from a filesystem scan of the official skill root conventions; the host half serves the `/api/dsh-skill-studio/*` route family on `node:fs`.

## ⚙️ Install

> **Prerequisite: [dsh-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar)
> must be installed separately** — this package consumes its `ctx.betterSidebar`
> service at runtime and deliberately declares no package dependency
> (structural mirror). Without better-sidebar the package installs and its
> host routes run, but the「技能管理」tab never appears.

```sh
dsh plugin --profile web add dsh-better-sidebar@latest                 # prerequisite
dsh plugin --profile web add @mhw12138/dsh-ui-better-sidebar-skill@latest
```

From source (after `pnpm install && pnpm build`):

```sh
dsh plugin --profile web add link:$(pwd)
```

Restart `dsh web`, then pick「技能管理」from the right panel's + menu.

## 🛣️ Routes

| Route | Method | Purpose |
| --- | --- | --- |
| `/api/dsh-skill-studio/list` | GET | Grouped skill list (`?cwd=` override) |
| `/api/dsh-skill-studio/read` | POST | Read SKILL.md (`{ path }`) |
| `/api/dsh-skill-studio/list-dir` | POST | List one directory level (lazy tree, `{ dir }`) |
| `/api/dsh-skill-studio/read-file` | POST | Read any file inside a skill dir (`{ path }`) |
| `/api/dsh-skill-studio/write` | POST | Save text content (`{ path, content }`) |
| `/api/dsh-skill-studio/create` | POST | Create a skill (`{ root, name, description, whenToUse?, content, cwd }`) |
| `/api/dsh-skill-studio/delete` | POST | Move into `.trash` (`{ path }`) |
| `/api/dsh-skill-studio/set-enabled` | POST | Toggle model invocation (`{ path, enabled }`) |
| `/api/dsh-skill-studio/health` | GET | Health check |

## 🔒 Security model

- Every route sits behind the loopback trust fence (socket address + Host header + browser same-origin markers); a live paired-device cookie from dsh-remote-web-ui is an extra allow path when that plugin is loaded. This package never hard-depends on remote-web-ui.
- Write routes only trust paths under the skill roots (project / global / system); system-bundled paths are read-only at the route level.
- Content caps: read/write 1MB, create 512KB. Markdown is rendered as React elements (no HTML injection).

## 📌 Known limits

- Frontmatter parsing is a zero-dependency lightweight implementation; exotic YAML follows the official dsh-skill-filesystem provider.
- The project group follows the workspace shown in the sidebar (`scope.cwd`); its project root is the nearest `.git` ancestor.
- UI copy is Chinese for now; an i18n namespace can be layered on later.

## 🙏 Acknowledgments

Built on top of the external [dsh-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar)
(MIT, by omdsh-dev) right-panel framework: the tab is registered through its
`ctx.betterSidebar` service and the file tree follows its Files explorer look.
This package is released under the [MIT License](LICENSE).
