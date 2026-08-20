/** Type shim for the platform primitives icons used by the file tree
 *  (resolved at runtime from the loader module table — external, never bundled).
 *  Script file on purpose: a `declare module` for a NEW module must live in a
 *  script (no top-level import/export), otherwise it becomes an augmentation. */
declare module '@deepseek-ai/dsh-client-ui-primitives' {
  export function IconCodeOutline16(props: { size?: number; className?: string }): JSX.Element
  export function IconFolderClose16(props: { size?: number; className?: string }): JSX.Element
  export function IconFolderOpen16(props: { size?: number; className?: string }): JSX.Element
}
