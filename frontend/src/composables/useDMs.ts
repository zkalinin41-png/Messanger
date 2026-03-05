import { ref, type Ref } from 'vue'
import { useAuth } from './useAuth'
import type { Conversation, DMMessage, FileData, ReplyTo, User } from '../types'

// Module-level shared state
export const conversations: Ref<Conversation[]> = ref([])
export const dmMessages: Ref<Record<string, DMMessage[]>> = ref({})
export const activeDMPartner: Ref<string | null> = ref(null)

export function useDMs() {
    const { token } = useAuth()

    function authHeaders(): Record<string, string> {
        return { Authorization: `Bearer ${token.value}` }
    }

    async function fetchConversations(): Promise<void> {
        const res = await fetch('/api/dms', { headers: authHeaders() })
        if (!res.ok) return
        const { conversations: c } = await res.json()
        conversations.value = c
    }

    async function fetchMessages(partner: string): Promise<any | null> {
        const res = await fetch(`/api/dms/${partner}`, { headers: authHeaders() })
        if (!res.ok) return null
        const data = await res.json()
        dmMessages.value[partner] = data.messages
        const conv = conversations.value.find((c: Conversation) => c.partner === partner)
        if (conv) conv.unread_count = 0
        return data
    }

    async function sendDM(partner: string, text: string, replyTo: ReplyTo | null = null, fileData: FileData | null = null): Promise<void> {
        const body: Record<string, any> = { text: text || '' }
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
    }

    async function searchUsers(q: string): Promise<User[]> {
        if (!q.trim()) return []
        const res = await fetch(`/api/users/search?q=${encodeURIComponent(q)}`, { headers: authHeaders() })
        if (!res.ok) return []
        const { users } = await res.json()
        return users
    }

    function clearState(): void {
        conversations.value = []
        dmMessages.value = {}
        activeDMPartner.value = null
    }

    return { conversations, dmMessages, activeDMPartner, fetchConversations, fetchMessages, sendDM, searchUsers, clearState }
}
