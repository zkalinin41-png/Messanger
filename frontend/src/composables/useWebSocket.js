import { ref } from 'vue'
import { groups, groupMessages, groupMembers, activeGroupId } from './useGroups'
import { conversations, dmMessages, activeDMPartner } from './useDMs'
import { useAuth } from './useAuth'
import { callState, callPartner, callToken, callUrl, fetchVideoToken, setWsSender } from './useVideoCall'

const WS_URL = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`
const { username } = useAuth()

// ── Singleton shared state ───────────────────────────────────────────────────
const ws = ref(null)
export const connected = ref(false)
export const joined = ref(false)
export const messages = ref([])
export const onlineUsers = ref([])
export const typingUsers = ref([])

export const groupsNeedRefresh = ref(false)
export const groupMemberUpdateId = ref(null)

export const dmTypingUsers = ref({})    // { [partnerUsername]: boolean }
export const groupTypingUsers = ref({}) // { [groupId]: string[] }
export const onlineStatuses = ref({})   // { [username]: { online: bool, lastSeen: number|null } }

const _error = ref(null)

// Give useVideoCall a way to send WS messages without a circular import
setWsSender((payload) => {
  if (ws.value?.readyState === WebSocket.OPEN) ws.value.send(JSON.stringify(payload))
})

// ── Timers ───────────────────────────────────────────────────────────────────
const typingTimers = {}
const dmTypingTimers = {}
const groupTypingTimers = {}
let reconnectTimer = null

// ── Message handler ──────────────────────────────────────────────────────────
function handleMessage(msg) {
  switch (msg.type) {
    case 'history':
      messages.value = msg.messages
      break

    case 'message': {
      messages.value.push(msg.data)
      const u = msg.data.username
      clearTimeout(typingTimers[u]); delete typingTimers[u]
      typingUsers.value = typingUsers.value.filter(n => n !== u)
      break
    }

    case 'system_message':
      messages.value.push(msg.data)
      break

    case 'users':
      onlineUsers.value = msg.users
      break

    case 'error':
      _error.value = msg.message
      break

    case 'typing': {
      const { username: u, isTyping } = msg
      if (isTyping) {
        if (!typingUsers.value.includes(u)) typingUsers.value.push(u)
        clearTimeout(typingTimers[u])
        typingTimers[u] = setTimeout(() => {
          typingUsers.value = typingUsers.value.filter(n => n !== u)
          delete typingTimers[u]
        }, 3000)
      } else {
        clearTimeout(typingTimers[u]); delete typingTimers[u]
        typingUsers.value = typingUsers.value.filter(n => n !== u)
      }
      break
    }

    case 'group_message': {
      const { groupId, data } = msg
      const gid = Number(groupId)
      if (!groupMessages.value[gid]) groupMessages.value[gid] = []
      groupMessages.value[gid].push(data)
      if (gid !== activeGroupId.value) {
        const g = groups.value.find(g => g.id === gid)
        if (g) g.unread_count = (g.unread_count || 0) + 1
      }
      // Clear this user's typing indicator when their message arrives
      if (groupTypingUsers.value[gid]) {
        groupTypingUsers.value[gid] = groupTypingUsers.value[gid].filter(u => u !== data.username)
      }
      break
    }

    case 'groups_refresh':
      groupsNeedRefresh.value = true
      break

    case 'group_updated': {
      const g = groups.value.find(g => g.id === Number(msg.groupId))
      if (g) { g.name = msg.name; g.description = msg.description }
      break
    }

    case 'group_deleted': {
      const gid = Number(msg.groupId)
      groups.value = groups.value.filter(g => g.id !== gid)
      delete groupMessages.value[gid]
      delete groupMembers.value[gid]
      break
    }

    case 'group_member_update':
      groupMemberUpdateId.value = Number(msg.groupId)
      break

    case 'dm_message': {
      const { data } = msg
      const partner = data.from_user === username.value ? data.to_user : data.from_user
      if (!dmMessages.value[partner]) dmMessages.value[partner] = []
      dmMessages.value[partner].push(data)
      // Update or create conversation entry
      const conv = conversations.value.find(c => c.partner === partner)
      if (conv) {
        conv.last_text = data.text || (data.file_name ? `📎 ${data.file_name}` : '')
        conv.last_timestamp = data.timestamp
        if (data.from_user !== username.value && partner !== activeDMPartner.value) {
          conv.unread_count = (conv.unread_count || 0) + 1
        }
      } else {
        conversations.value.push({
          partner,
          color: data.color,
          last_text: data.text || (data.file_name ? `📎 ${data.file_name}` : ''),
          last_timestamp: data.timestamp,
          unread_count: data.from_user !== username.value ? 1 : 0,
          online: onlineStatuses.value[partner]?.online ?? false,
          last_seen_at: null,
        })
      }
      conversations.value.sort((a, b) => b.last_timestamp - a.last_timestamp)
      // Clear typing indicator when message arrives
      if (dmTypingUsers.value[partner]) {
        dmTypingUsers.value[partner] = false
        clearTimeout(dmTypingTimers[partner]); delete dmTypingTimers[partner]
      }
      break
    }

    case 'dm_delivered': {
      // Our messages to msg.byUser are now delivered
      const msgs = dmMessages.value[msg.byUser]
      if (msgs && msg.ids) {
        const idSet = new Set(msg.ids)
        msgs.forEach(m => { if (idSet.has(m.id)) m.status = 'delivered' })
      }
      break
    }

    case 'dm_read': {
      // msg.byUser has read our messages
      const msgs = dmMessages.value[msg.byUser]
      if (msgs) {
        msgs.forEach(m => {
          if (m.from_user === username.value && m.status !== 'read') m.status = 'read'
        })
      }
      break
    }

    case 'dm_typing': {
      const { fromUser, isTyping } = msg
      dmTypingUsers.value[fromUser] = isTyping
      clearTimeout(dmTypingTimers[fromUser])
      if (isTyping) {
        dmTypingTimers[fromUser] = setTimeout(() => {
          dmTypingUsers.value[fromUser] = false
        }, 4000)
      } else {
        delete dmTypingTimers[fromUser]
      }
      break
    }

    case 'group_typing': {
      const { groupId: gid, username: u, isTyping } = msg
      const id = Number(gid)
      if (!groupTypingUsers.value[id]) groupTypingUsers.value[id] = []
      const key = `${id}:${u}`
      if (isTyping) {
        if (!groupTypingUsers.value[id].includes(u)) groupTypingUsers.value[id].push(u)
        clearTimeout(groupTypingTimers[key])
        groupTypingTimers[key] = setTimeout(() => {
          groupTypingUsers.value[id] = (groupTypingUsers.value[id] || []).filter(n => n !== u)
        }, 4000)
      } else {
        clearTimeout(groupTypingTimers[key]); delete groupTypingTimers[key]
        groupTypingUsers.value[id] = groupTypingUsers.value[id].filter(n => n !== u)
      }
      break
    }

    case 'online_status': {
      onlineStatuses.value[msg.username] = { online: msg.online, lastSeen: msg.lastSeen ?? null }
      const conv = conversations.value.find(c => c.partner === msg.username)
      if (conv) {
        conv.online = msg.online
        if (!msg.online && msg.lastSeen) conv.last_seen_at = msg.lastSeen
      }
      break
    }

    case 'call_invite':
      callState.value = 'incoming'
      callPartner.value = msg.fromUser
      break

    case 'call_accept':
      // We are the caller — fetch our own token and go connected
      fetchVideoToken(callPartner.value).then(({ token, url }) => {
        callToken.value = token
        callUrl.value = url
        callState.value = 'connected'
      }).catch(err => {
        console.error('Video token error:', err)
        callState.value = 'idle'
        callPartner.value = null
      })
      break

    case 'call_reject':
      callState.value = 'idle'
      callPartner.value = null
      break

    case 'call_end':
      callState.value = 'idle'
      callPartner.value = null
      callToken.value = null
      callUrl.value = null
      break
  }
}

// ── Connection ───────────────────────────────────────────────────────────────
function connect() {
  clearTimeout(reconnectTimer)
  reconnectTimer = null
  const state = ws.value?.readyState
  if (state === WebSocket.CONNECTING || state === WebSocket.OPEN) return

  ws.value = new WebSocket(WS_URL)

  ws.value.onopen = () => {
    connected.value = true
    _error.value = null
  }

  ws.value.onmessage = (event) => {
    try { handleMessage(JSON.parse(event.data)) } catch { /* ignore parse errors */ }
  }

  ws.value.onclose = () => {
    connected.value = false
    joined.value = false
    reconnectTimer = setTimeout(connect, 1000)
  }

  ws.value.onerror = () => {
    _error.value = 'Connection error'
  }
}

// ── Composable ───────────────────────────────────────────────────────────────
export function useWebSocket() {
  function join(token) {
    if (joined.value) return
    if (ws.value?.readyState === WebSocket.OPEN) {
      ws.value.send(JSON.stringify({ type: 'join', token }))
      joined.value = true
    }
  }

  function sendMessage(text) {
    if (ws.value?.readyState === WebSocket.OPEN && text.trim()) {
      ws.value.send(JSON.stringify({ type: 'message', text }))
    }
  }

  function sendGroupMessage(groupId, text, replyTo = null, fileData = null) {
    if (ws.value?.readyState === WebSocket.OPEN && (text.trim() || fileData)) {
      const payload = { type: 'group_message', groupId, text: text || '' }
      if (replyTo) {
        payload.reply_to_id = replyTo.id
        payload.reply_to_text = replyTo.text || replyTo.file_name || ''
        payload.reply_to_username = replyTo.username ?? replyTo.from_user
      }
      if (fileData) {
        payload.file_url = fileData.url
        payload.file_name = fileData.name
        payload.file_type = fileData.type
        payload.file_size = fileData.size
      }
      ws.value.send(JSON.stringify(payload))
    }
  }

  function sendTyping(isTyping) {
    if (ws.value?.readyState === WebSocket.OPEN) {
      ws.value.send(JSON.stringify({ type: 'typing', isTyping }))
    }
  }

  function sendDMTyping(toUser, isTyping) {
    if (ws.value?.readyState === WebSocket.OPEN) {
      ws.value.send(JSON.stringify({ type: 'dm_typing', toUser, isTyping }))
    }
  }

  function sendGroupTyping(groupId, isTyping) {
    if (ws.value?.readyState === WebSocket.OPEN) {
      ws.value.send(JSON.stringify({ type: 'group_typing', groupId, isTyping }))
    }
  }

  function disconnect() {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
    Object.keys(typingTimers).forEach(k => { clearTimeout(typingTimers[k]); delete typingTimers[k] })
    Object.keys(dmTypingTimers).forEach(k => { clearTimeout(dmTypingTimers[k]); delete dmTypingTimers[k] })
    Object.keys(groupTypingTimers).forEach(k => { clearTimeout(groupTypingTimers[k]); delete groupTypingTimers[k] })
    if (ws.value) {
      ws.value.onclose = null
      ws.value.close()
      ws.value = null
    }
    connected.value = false
    joined.value = false
    messages.value = []
    onlineUsers.value = []
    typingUsers.value = []
  }

  return {
    connected, messages, onlineUsers, error: _error, joined, typingUsers,
    join, sendMessage, sendGroupMessage, sendTyping, sendDMTyping, sendGroupTyping,
    disconnect, connect,
  }
}
