const COLORS = [
  '#6366f1', '#8b5cf6', '#ec4899', '#14b8a6',
  '#f59e0b', '#10b981', '#3b82f6', '#f97316',
]

export function usernameColor(username) {
  let h = 0
  for (const ch of username) h = (h * 31 + ch.charCodeAt(0)) & 0xffff
  return COLORS[h % COLORS.length]
}
