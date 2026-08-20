/** Tab icon for the skill-studio sidebar tab (a document with lines). */
export function TabIcon({ size = 14 }: { size?: number }): React.JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={1.3} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 1.5h6l3 3v10H4z" />
      <path d="M10 1.5v3h3" />
      <path d="M6 7.5h5M6 10h5M6 5h2" />
    </svg>
  )
}
