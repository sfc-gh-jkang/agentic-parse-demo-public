/** Browser-side half of the presenter reset: forget chat, panels, tour and theme. */
export const STORAGE_PREFIX = "agentic-parse-demo:"

export interface ResetStorage { length: number; key(i: number): string | null; removeItem(k: string): void; setItem(k: string, v: string): void }

/** Removes every demo key from session storage and sets the light theme (next-themes key "theme"). Returns removed keys. */
export function clearClientState(session: ResetStorage, local: ResetStorage): string[] {
  const keys: string[] = []
  for (let i = 0; i < session.length; i++) {
    const k = session.key(i)
    if (k?.startsWith(STORAGE_PREFIX)) keys.push(k)
  }
  keys.forEach((k) => session.removeItem(k))
  local.setItem("theme", "light")
  return keys
}
