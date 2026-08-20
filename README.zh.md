# @mhw12138/dsh-ui-better-sidebar-skill

[English](README.md)

DSH Web GUI 的**技能工作台**：按来源分级浏览全局与项目 skill，预览
`SKILL.md`、内联编辑保存、启用/禁用模型调用、创建与删除——以 Tab 形式挂载到
外部插件 [dsh-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar)
的右侧面板（通过 `ctx.betterSidebar.registerTab` 注册，无 DOM 注入）。

## 功能

- **better-sidebar 右侧面板 Tab（「技能管理」）**：通过外部插件的注册表服务
  注册真实 Tab，是 better-sidebar 官方推荐的第三方接入方式。
- **分级技能列表 + 搜索**：
  - 项目：当前工作区（最近的 `.git` 祖先）下的 `.dsh/skills` 与 `.agents/skills`；
  - 全局（用户）：`~/.dsh/skills` 与 `~/.agents/skills`；
  - 系统内置（只读）：所有已注册 agent preset 的 `<preset>/skills`。
- **预览**：零依赖 Markdown 渲染（标题、代码块、列表、引用、链接并净化
  href；输出 React 元素，绝不渲染原始 HTML）。
- **编辑**：面板内 textarea 直接编辑完整 `SKILL.md`（含 frontmatter），保存
  时原子写回文件。
- **管理**：新建（写入用户根或项目根，生成标准 SKILL.md）、删除（移入可恢复
  的 `.trash`）、启用/禁用模型调用（改写 frontmatter 的
  `disable-model-invocation`）。
- **系统组只读**：内置 skill 只可预览，不可编辑/删除/启停——由 host 路由层
  强制，而非仅 UI 层。

## 架构

- **host 半区**（`src/index.ts` + `src/routes.ts` + `src/collect.ts` +
  `src/frontmatter.ts` + `src/access.ts`）：以 `node:fs` 按官方根约定扫描，
  通过共享信任围栏提供 `/api/dsh-skill-studio/*` 路由族。
- **client 半区**（`src/client/`）：经 better-sidebar 服务注册 Tab（结构镜像，
  不硬依赖该包）并渲染面板。

## 安装

> **前提条件：[dsh-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar)
> 需单独安装**——本插件通过外部插件的 `ctx.betterSidebar` 服务注册 Tab，
> 刻意不声明依赖（结构镜像）。未装 better-sidebar 时本插件可安装、Host 路由
> 正常，但「技能管理」Tab 不会出现。

```sh
dsh plugin --profile web add dsh-better-sidebar@latest   # 前提
dsh plugin --profile web add @mhw12138/dsh-ui-better-sidebar-skill@latest
```

本目录下执行 `pnpm install && pnpm build` 后亦可本地链接安装：

```sh
dsh plugin --profile web add link:$(pwd)
```

重启 `dsh web`，打开右侧面板 + 菜单选择「技能管理」。

## 路由

| 路由 | 方法 | 说明 |
| --- | --- | --- |
| `/api/dsh-skill-studio/list` | GET | 分级技能列表（`?cwd=` 覆盖） |
| `/api/dsh-skill-studio/read` | POST | 读取一个 SKILL.md（`{ path }`） |
| `/api/dsh-skill-studio/write` | POST | 保存编辑内容（`{ path, content }`） |
| `/api/dsh-skill-studio/create` | POST | 创建 skill（`{ root, name, description, whenToUse?, content, cwd }`） |
| `/api/dsh-skill-studio/delete` | POST | 移入 `.trash`（`{ path }`） |
| `/api/dsh-skill-studio/set-enabled` | POST | 启停 `disable-model-invocation`（`{ path, enabled }`） |
| `/api/dsh-skill-studio/health` | GET | 健康检查 |

## 安全模型

- 全部路由走 loopback 信任围栏（socket 地址 + Host 头 + 浏览器同源标记）；
  装了 dsh-remote-web-ui 时，有效已配对设备 cookie 为额外放行路径。本插件
  不硬依赖 remote-web-ui。
- 写路由只信任**最新文件系统扫描产出**的路径——请求无法指定任意文件；
  系统内置路径在路由层只读。
- 内容上限：read/write 1MB、create 512KB；面板 Markdown 以 React 元素渲染
  （无 HTML 注入）。

## 已知限制

- frontmatter 解析为零依赖轻量实现（块标量、布尔、input 嵌套块）；生僻
  YAML 以官方 dsh-skill-filesystem 提供方为准。
- 项目组跟随侧边栏显示的 workspace（`scope.cwd`）；创建表单发送该 workspace，
  项目根为其最近 `.git` 祖先。
- 界面文案暂为中文，后续可叠加 i18n 命名空间。

## 致谢

本插件基于外部插件
[dsh-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar)
（MIT 协议，作者 omdsh-dev）的右侧面板框架开发：「技能管理」Tab 通过其
`ctx.betterSidebar` 服务注册，文件树沿用其 Files 资源管理器的视觉风格。
本插件运行时依赖 dsh-better-sidebar（请先安装，见[安装](#安装)），并以
[MIT 协议](LICENSE) 发布。
