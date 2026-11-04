/**
 * A template (not a layout) remounts on every navigation inside the app, which is what lets the incoming screen
 * play its short fade-up. The shell around it (sidebar, header) is in the layout and never re-animates.
 */
export default function AppTemplate({ children }: { children: React.ReactNode }) {
  return <div className="page-in">{children}</div>
}
