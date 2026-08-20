# @mhw12138/dsh-ui-better-sidebar-skill

[中文](README.zh.md)

A **skill studio** for the DSH Web GUI: browse global and project skills by
source, preview `SKILL.md`, edit and save, enable/disable model invocation,
create and delete — delivered as a tab in the external
[dsh-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar) right
panel (registered through `ctx.betterSidebar.registerTab`, no DOM hacks).

## Features

- **Tab in the better-sidebar right panel** («技能管理»): the panel is a real
  tab registered via the external plugin's registry service — third-party
  integration exactly as better-sidebar intends.
- **Grouped skill list** by source with a search box:
  - 项目 (project): `<project root>/.dsh/skills` and `.agents/skills` of the
    active workspace (nearest `.git` ancestor);
  - 全局 (user): `~/.dsh/skills` and `~/.agents/skills`;
  - 系统 (system bundled, read-only): `<preset>/skills` of every registered
    agent preset.
- **Preview**: zero-dependency Markdown renderer (headings, code blocks,
  lists, quotes, links with sanitized hrefs; React elements, never raw HTML).
- **Edit**: inline textarea over the full `SKILL.md` (frontmatter included),
  explicit Save that atomically rewrites the file.
- **Manage**: create (user or project root, generates a standard SKILL.md),
  delete (moves the file into a recoverable `.trash`), enable/disable model
  invocation (rewrites the `disable-model-invocation` frontmatter field).
- **Read-only system group**: bundled skills can be previewed but never
  edited/deleted/toggled — enforced by the host routes, not just the UI.

## Architecture

- **Host half** (`src/index.ts` + `src/routes.ts` + `src/collect.ts` +
  `src/frontmatter.ts` + `src/access.ts`): serves the
  `/api/dsh-skill-studio/*` route family over the shared trust fence and
  scans the official skill root conventions with `node:fs`.
- **Client half** (`src/client/`): registers the tab through the
  better-sidebar service (structural mirror — no hard dependency on that
  package) and renders the panel.

## Install

> **Prerequisite: [dsh-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar)
> must be installed separately** — this package registers its tab through the
> external plugin's `ctx.betterSidebar` service and deliberately declares no
> dependency on it (structural mirror). Without better-sidebar the package
> installs and its host routes run, but the「技能管理」tab never appears.

```sh
dsh plugin --profile web add dsh-better-sidebar@latest   # prerequisite
dsh plugin --profile web add @mhw12138/dsh-ui-better-sidebar-skill@latest
```

From this directory (after `pnpm install && pnpm build`):

```sh
dsh plugin --profile web add link:$(pwd)
```

Restart `dsh web`; open the right panel's + menu and pick「技能管理」.

## Routes

| Route | Method | Purpose |
| --- | --- | --- |
| `/api/dsh-skill-studio/list` | GET | Grouped skill list (`?cwd=` override) |
| `/api/dsh-skill-studio/read` | POST | Read one SKILL.md (`{ path }`) |
| `/api/dsh-skill-studio/write` | POST | Save edited content (`{ path, content }`) |
| `/api/dsh-skill-studio/create` | POST | Create skill (`{ root, name, description, whenToUse?, content, cwd }`) |
| `/api/dsh-skill-studio/delete` | POST | Move to `.trash` (`{ path }`) |
| `/api/dsh-skill-studio/set-enabled` | POST | Toggle `disable-model-invocation` (`{ path, enabled }`) |
| `/api/dsh-skill-studio/health` | GET | Health check |

## Security model

- Every route runs behind the loopback trust fence (socket address + Host
  header + browser same-origin markers); a live paired-device cookie from
  dsh-remote-web-ui is an extra allow path when that plugin is loaded. This
  plugin never hard-depends on remote-web-ui.
- Write routes only trust paths from a **fresh filesystem scan** — a request
  can never name an arbitrary file. System-bundled paths are read-only at the
  route level.
- Content caps: read/write 1MB, create 512KB. The panel renders Markdown as
  React elements (no HTML injection).

## Known limits

- Frontmatter parsing is a zero-dependency lightweight implementation
  (block scalars, booleans, input nested block); exotic YAML follows the
  official dsh-skill-filesystem provider's behavior.
- The project group follows the workspace shown in the sidebar (`scope.cwd`);
  the create form sends that workspace and the project root is its nearest
  `.git` ancestor.
- UI copy is Chinese for now; an i18n namespace can be layered on later.

## Acknowledgments

This plugin is built on top of the excellent external
[dsh-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar) (MIT,
by omdsh-dev) right-panel framework: the「技能管理」tab is registered through
its `ctx.betterSidebar` service, and the file tree follows the visual style of
its Files explorer. This package depends on dsh-better-sidebar at runtime
(install it first — see [Install](#install)) and is released under the
[MIT License](LICENSE).
