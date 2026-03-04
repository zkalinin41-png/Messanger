import { ref } from 'vue'
import { useAuth } from './useAuth'

// Module-level shared state
export const conversations = ref([])  // [{ partner, color, last_text, last_timestamp, unread_count, online, last_seen_at }]
export const dmMessages = ref({})     // { [partner]: Message[] }
export const activeDMPartner = ref(null)

export function useDMs() {
  const { token } = useAuth()

  function authHeaders() {
    return { Authorization: `Bearer ${token.value}` }
  }

  async function fetchConversations() {
    const res = await fetch('/api/dms', { headers: authHeaders() })
    if (!res.ok) return
    const { conversations: c } = await res.json()
    conversations.value = c
  }

  async function fetchMessages(partner) {
    const res = await fetch(`/api/dms/${partner}`, { headers: authHeaders() })
    if (!res.ok) return null
    const data = await res.json()
    dmMessages.value[partner] = data.messages
    const conv = conversations.value.find(c => c.partner === partner)
    if (conv) conv.unread_count = 0
    return data
  }

  async function sendDM(partner, text, replyTo = null, fileData = null) {
    const body = { text: text || '' }
    if (replyTo) {
      body.reply_to_id = replyTo.id
      body.reply_to_text = replyTo.text || replyTo.file_name || ''
      body.reply_to_username = replyTo.from_user
    }
    if (fileData) {
      body.file_url = fileData.url
      body.file_name = fileData.name
      body.file_type = fileData.type
      body.file_size = fileData.size
    }
    const res = await fetch(`/api/dms/${partner}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error((await res.json()).error || 'Failed to send')
    // Message arrives via WS echo — no need to push manually
  }

  async function searchUsers(q) {
    if (!q.trim()) return []
    const res = await fetch(`/api/users/search?q=${encodeURIComponent(q)}`, { headers: authHeaders() })
    if (!res.ok) return []
    const { users } = await res.json()
    return users
  }

  function clearState() {
    conversations.value = []
    dmMessages.value = {}
    activeDMPartner.value = null
  }

  return { conversations, dmMessages, activeDMPartner, fetchConversations, fetchMessages, sendDM, searchUsers, clearState }
}
