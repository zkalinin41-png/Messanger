<script setup>
import { ref, computed, nextTick, watch, onMounted } from 'vue'
import { useWebSocket } from '@/composables/useWebSocket'
import { useAuth } from '@/composables/useAuth'
import { useTheme } from '@/composables/useTheme'
import { useGroups } from '@/composables/useGroups'
import { useDMs } from '@/composables/useDMs'
import { groupsNeedRefresh, groupMemberUpdateId, onlineStatuses } from '@/composables/useWebSocket'
import { usernameColor } from '@/utils/color'
import AuthView from '@/components/AuthView.vue'
import SettingsPanel from '@/components/SettingsPanel.vue'
import GroupChatView from '@/components/GroupChatView.vue'
import DMChatView from '@/components/DMChatView.vue'
import CreateGroupModal from '@/components/CreateGroupModal.vue'
import NewDMModal from '@/components/NewDMModal.vue'
import Button from '@/components/ui/button/Button.vue'
import TooltipProvider from '@/components/ui/tooltip/TooltipProvider.vue'
import { MessageCircle, Send, Hash, Wifi, WifiOff, Settings, LogOut, Users, Plus, Phone, PhoneOff, Search } from 'lucide-vue-next'
import { useVideoCall, callState, callPartner } from '@/composables/useVideoCall'
import SearchModal from '@/components/SearchModal.vue'

const { token, username, isAuthenticated, logout } = useAuth()
const { acceptCall, rejectCall } = useVideoCall()
const { connected, messages, onlineUsers, error, joined, typingUsers, join, sendMessage, sendTyping, disconnect, connect } = useWebSocket()
const { isDark } = useTheme()
const { groups, groupMessages, activeGroupId, fetchGroups, fetchMessages, fetchGroupDetails } = useGroups()
const { conversations, activeDMPartner, fetchConversations, clearState: clearDMState } = useDMs()

const messageInput = ref('')
const textareaRef = ref(null)
const messagesContainer = ref(null)
const showSettings = ref(false)
const showCreateGroup = ref(false)
const showNewDM = ref(false)
const showSearch = ref(false)

let typingDebounce = null

// ── Browser notifications ───────────────────────────────────────────────────
function requestNotificationPermission() {
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission()
  }
}

function sendBrowserNotification(title, body) {
  if (!('Notification' in window)) return
  if (Notification.permission !== 'granted') return
  if (document.hasFocus()) return
  try {
    const n = new Notification(title, { body, icon: '/favicon.ico' })
    n.onclick = () => { window.focus(); n.close() }
    setTimeout(() => n.close(), 5000)
  } catch { /* ignore */ }
}

// ------- Derived state -------

const currentUserColor = computed(() => usernameColor(username.value ?? ''))

const viewingGeneral = computed(() =>
  activeGroupId.value === null && activeDMPartner.value === null && !showSettings.value
)

const messageGroups = computed(() => {
  const groups = []
  for (const msg of messages.value) {
    if (msg.type === 'system') {
      groups.push({ type: 'system', id: msg.timestamp, message: msg.message })
      continue
    }
    const prev = groups[groups.length - 1]
    const canMerge =
      prev &&
      prev.type === 'user' &&
      prev.username === msg.username &&
      msg.timestamp - prev.lastTimestamp < 5 * 60 * 1000
    if (canMerge) {
      prev.items.push(msg)
      prev.lastTimestamp = msg.timestamp
    } else {
      groups.push({
        type: 'user',
        id: msg.id,
        username: msg.username,
        color: msg.color,
        items: [msg],
        lastTimestamp: msg.timestamp,
      })
    }
  }
  return groups
})

const typingText = computed(() => {
  const t = typingUsers.value
  if (t.length === 0) return ''
  if (t.length === 1) return `${t[0]} is typing...`
  if (t.length === 2) return `${t[0]} and ${t[1]} are typing...`
  return 'Several people are typing...'
})

// ------- Auth / connection -------

onMounted(() => {
  if (isAuthenticated.value) {
    requestNotificationPermission()
    if (connected.value && !joined.value) {
      join(token.value)
    } else if (!connected.value) {
      connect()
    }
  }
})

function handleAuthenticated() {
  showSettings.value = false
  requestNotificationPermission()
  if (connected.value) {
    join(token.value)
  } else {
    connect()
  }
}

watch(connected, (isConnected) => {
  if (isConnected && isAuthenticated.value && !joined.value) {
    join(token.value)
  }
})

watch(error, (val) => {
  if (val === 'Invalid or expired session. Please log in again.') {
    logout()
  }
})

// Load groups + DM conversations once joined
watch(joined, (v) => {
  if (v) {
    fetchGroups()
    fetchConversations()
  }
})

// Refresh groups when server signals new membership
watch(groupsNeedRefresh, (v) => {
  if (v) { fetchGroups(); groupsNeedRefresh.value = false }
})

// Refresh member list when a member update arrives for the active group
watch(groupMemberUpdateId, (gid) => {
  if (gid !== null) {
    if (activeGroupId.value === gid) fetchGroupDetails(gid)
    groupMemberUpdateId.value = null
  }
})

// Browser notification for incoming calls
watch(callState, (state) => {
  if (state === 'incoming') {
    sendBrowserNotification(`${callPartner.value} is calling`, 'Incoming video call')
  }
})

// Browser notification for new DM messages
watch(() => conversations.value.map(c => c.unread_count).join(','), (newVal, oldVal) => {
  if (!oldVal) return
  const newCounts = newVal.split(',').map(Number)
  const oldCounts = oldVal.split(',').map(Number)
  for (let i = 0; i < conversations.value.length; i++) {
    if (newCounts[i] > (oldCounts[i] || 0)) {
      const conv = conversations.value[i]
      sendBrowserNotification(`New message from ${conv.partner}`, conv.last_text || 'Sent a file')
      break
    }
  }
})

// When switching to a group — load messages + members
watch(activeGroupId, async (gid) => {
  if (gid === null) return
  showSettings.value = false
  activeDMPartner.value = null
  await fetchMessages(gid)
  await fetchGroupDetails(gid)
})

// If the active group gets deleted/removed, fall back to general chat
watch(groups, (list) => {
  if (activeGroupId.value !== null && !list.find(g => g.id === activeGroupId.value)) {
    activeGroupId.value = null
  }
}, { deep: true })

function handleLogout() {
  disconnect()
  logout()
  activeGroupId.value = null
  activeDMPartner.value = null
  clearDMState()
}

// ------- Navigation -------

function openGroup(id) {
  activeGroupId.value = id
  activeDMPartner.value = null
  showSettings.value = false
}

function openGeneral() {
  activeGroupId.value = null
  activeDMPartner.value = null
  showSettings.value = false
}

function openDM(partner) {
  activeDMPartner.value = partner
  activeGroupId.value = null
  showSettings.value = false
}

// ------- General chat messaging -------

function handleSend() {
  const text = messageInput.value.trim()
  if (!text) return
  clearTimeout(typingDebounce)
  sendTyping(false)
  sendMessage(text)
  messageInput.value = ''
  nextTick(() => {
    if (textareaRef.value) textareaRef.value.style.height = 'auto'
  })
}

function handleKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    handleSend()
  }
}

function handleInputChange() {
  nextTick(() => {
    const el = textareaRef.value
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 128) + 'px'
  })
  if (messageInput.value.trim()) {
    sendTyping(true)
    clearTimeout(typingDebounce)
    typingDebounce = setTimeout(() => sendTyping(false), 3000)
  } else {
    clearTimeout(typingDebounce)
    sendTyping(false)
  }
}

// ------- Helpers -------

function formatTime(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function scrollToBottom() {
  nextTick(() => {
    const el = messagesContainer.value
    if (el) el.scrollTop = el.scrollHeight
  })
}

watch(messages, scrollToBottom, { deep: true })
watch(joined, (v) => { if (v) scrollToBottom() })
</script>

<template>
  <TooltipProvider>

    <!-- ── Auth screen ── -->
    <div
      v-if="!isAuthenticated"
      class="h-screen w-screen flex items-center justify-center bg-muted/50"
    >
      <AuthView @authenticated="handleAuthenticated" />
    </div>

    <!-- ── App shell ── -->
    <div v-else class="h-screen w-screen overflow-hidden flex bg-background text-foreground">

      <!-- ════ Sidebar ════ -->
      <aside class="w-56 flex-shrink-0 flex flex-col border-r border-border" style="background: hsl(var(--muted) / 0.4)">

        <!-- App header -->
        <div class="h-12 px-4 flex items-center gap-2 border-b border-border">
          <MessageCircle class="w-4 h-4 text-muted-foreground flex-shrink-0" />
          <span class="font-semibold text-sm">ChatApp</span>
          <button
            class="ml-auto p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            title="Search messages"
            @click="showSearch = true"
          >
            <Search class="w-3.5 h-3.5" />
          </button>
          <span
            class="w-1.5 h-1.5 rounded-full flex-shrink-0 transition-colors"
            :class="connected ? 'bg-emerald-500' : 'bg-amber-400'"
          />
        </div>

        <!-- Channels -->
        <div class="px-2 py-2 border-b border-border">
          <p class="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest px-2 mb-1">Channels</p>
          <button
            class="w-full flex items-center gap-1.5 px-2 py-1.5 rounded-md text-sm transition-colors"
            :class="viewingGeneral ? 'bg-accent text-accent-foreground font-medium' : 'hover:bg-accent/60 text-muted-foreground'"
            @click="openGeneral"
          >
            <Hash class="w-3.5 h-3.5 flex-shrink-0" />
            general
          </button>
        </div>

        <!-- Groups -->
        <div class="px-2 py-2 border-b border-border">
          <div class="flex items-center gap-1 px-2 mb-1">
            <p class="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest flex-1">Groups</p>
            <button
              class="p-0.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
              title="Create group"
              @click="showCreateGroup = true"
            >
              <Plus class="w-3 h-3" />
            </button>
          </div>

          <div v-if="groups.length === 0" class="px-2 py-1 text-xs text-muted-foreground opacity-60">
            No groups yet
          </div>

          <button
            v-for="group in groups"
            :key="group.id"
            class="w-full flex items-center gap-1.5 px-2 py-1.5 rounded-md text-sm transition-colors"
            :class="activeGroupId === group.id ? 'bg-accent text-accent-foreground font-medium' : 'hover:bg-accent/60 text-muted-foreground'"
            @click="openGroup(group.id)"
          >
            <Users class="w-3.5 h-3.5 flex-shrink-0" />
            <span class="truncate flex-1 text-left">{{ group.name }}</span>
            <span
              v-if="group.unread_count > 0"
              class="ml-auto flex-shrink-0 min-w-[18px] h-[18px] rounded-full bg-violet-600 text-white text-[10px] font-bold flex items-center justify-center px-1"
            >
              {{ group.unread_count > 99 ? '99+' : group.unread_count }}
            </span>
          </button>
        </div>

        <!-- Direct Messages -->
        <div class="px-2 py-2 border-b border-border">
          <div class="flex items-center gap-1 px-2 mb-1">
            <p class="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest flex-1">Direct Messages</p>
            <button
              class="p-0.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
              title="New message"
              @click="showNewDM = true"
            >
              <Plus class="w-3 h-3" />
            </button>
          </div>

          <div v-if="conversations.length === 0" class="px-2 py-1 text-xs text-muted-foreground opacity-60">
            No messages yet
          </div>

          <button
            v-for="conv in conversations"
            :key="conv.partner"
            class="w-full flex items-center gap-2 px-2 py-1.5 rounded-md transition-colors"
            :class="activeDMPartner === conv.partner ? 'bg-accent text-accent-foreground font-medium' : 'hover:bg-accent/60 text-muted-foreground'"
            @click="openDM(conv.partner)"
          >
            <div class="relative flex-shrink-0">
              <div
                class="w-5 h-5 rounded-full flex items-center justify-center text-white text-[9px] font-bold"
                :style="{ backgroundColor: conv.color }"
              >
                {{ conv.partner.slice(0, 2).toUpperCase() }}
              </div>
              <div
                class="absolute -bottom-px -right-px w-1.5 h-1.5 rounded-full border border-background"
                :class="(onlineStatuses[conv.partner]?.online ?? conv.online) ? 'bg-emerald-500' : 'bg-muted-foreground/30'"
              />
            </div>
            <span class="text-xs truncate flex-1 text-left">{{ conv.partner }}</span>
            <span
              v-if="conv.unread_count > 0"
              class="ml-auto flex-shrink-0 min-w-[16px] h-[16px] rounded-full bg-violet-600 text-white text-[9px] font-bold flex items-center justify-center px-0.5"
            >
              {{ conv.unread_count > 99 ? '99+' : conv.unread_count }}
            </span>
          </button>
        </div>

        <!-- Online users -->
        <div class="flex-1 overflow-y-auto px-2 py-2">
          <p class="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest px-2 mb-1">
            Online — {{ onlineUsers.length }}
          </p>
          <div
            v-for="user in onlineUsers"
            :key="user.username"
            class="flex items-center gap-2 px-2 py-1.5 rounded-md select-none transition-colors"
            :class="user.username !== username ? 'cursor-pointer hover:bg-accent/60' : 'cursor-default'"
            @click="user.username !== username && openDM(user.username)"
          >
            <div class="relative flex-shrink-0">
              <div
                class="w-6 h-6 rounded-full flex items-center justify-center text-white text-[10px] font-bold"
                :style="{ backgroundColor: user.color }"
              >
                {{ user.username.slice(0, 1).toUpperCase() }}
              </div>
              <div class="absolute -bottom-px -right-px w-2 h-2 rounded-full bg-emerald-500 border border-background" />
            </div>
            <span
              class="text-xs truncate"
              :class="user.username === username ? 'font-semibold text-foreground' : 'text-muted-foreground'"
            >
              {{ user.username }}
            </span>
            <span v-if="user.username === username" class="ml-auto text-[9px] text-muted-foreground">you</span>
          </div>
        </div>

        <!-- User footer -->
        <div class="border-t border-border p-2 space-y-0.5">
          <div class="flex items-center gap-2 px-2 py-1">
            <div
              class="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
              :style="{ backgroundColor: currentUserColor }"
            >
              {{ username?.slice(0, 1).toUpperCase() }}
            </div>
            <div class="flex-1 min-w-0">
              <p class="text-xs font-semibold truncate leading-tight">{{ username }}</p>
              <p class="text-[10px] text-muted-foreground leading-tight">
                {{ connected ? 'Online' : 'Reconnecting…' }}
              </p>
            </div>
            <button
              class="p-1 rounded-md transition-colors flex-shrink-0"
              :class="showSettings ? 'text-foreground bg-accent' : 'text-muted-foreground hover:bg-accent hover:text-foreground'"
              title="Settings"
              @click="showSettings = !showSettings; activeGroupId = null; activeDMPartner = null"
            >
              <Settings class="w-3.5 h-3.5" />
            </button>
          </div>
          <button
            class="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
            @click="handleLogout"
          >
            <LogOut class="w-3.5 h-3.5" />
            Sign out
          </button>
        </div>
      </aside>

      <!-- ════ Main content ════ -->
      <main class="flex-1 flex flex-col overflow-hidden">

        <!-- Connecting spinner -->
        <div v-if="!joined" class="flex-1 flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <svg class="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
          </svg>
          Connecting to server…
        </div>

        <!-- Settings view -->
        <SettingsPanel v-else-if="showSettings" @close="showSettings = false" />

        <!-- DM chat -->
        <DMChatView
          v-else-if="activeDMPartner !== null"
          :partner="activeDMPartner"
        />

        <!-- Group chat -->
        <GroupChatView
          v-else-if="activeGroupId !== null"
          :group-id="activeGroupId"
        />

        <!-- General chat -->
        <template v-else>

          <!-- Chat header -->
          <div class="h-12 px-4 flex items-center gap-2 border-b border-border flex-shrink-0">
            <Hash class="w-4 h-4 text-muted-foreground flex-shrink-0" />
            <span class="font-semibold text-sm">general</span>
            <div class="ml-auto flex items-center gap-1.5">
              <Wifi v-if="connected" class="w-3.5 h-3.5 text-emerald-500" />
              <WifiOff v-else class="w-3.5 h-3.5 text-amber-400" />
              <span class="text-xs text-muted-foreground">{{ connected ? 'Live' : 'Reconnecting…' }}</span>
            </div>
          </div>

          <!-- Messages -->
          <div ref="messagesContainer" class="flex-1 overflow-y-auto px-4 py-4">

            <div v-if="messageGroups.length === 0" class="flex flex-col items-center justify-center h-40 text-muted-foreground">
              <MessageCircle class="w-10 h-10 mb-2 opacity-20" />
              <p class="text-sm">No messages yet — say hi!</p>
            </div>

            <template v-for="group in messageGroups" :key="group.id">

              <!-- System message -->
              <div v-if="group.type === 'system'" class="flex justify-center py-3">
                <span class="text-[11px] text-muted-foreground bg-muted/60 px-3 py-0.5 rounded-full select-none">
                  {{ group.message }}
                </span>
              </div>

              <!-- Message group -->
              <div
                v-else
                class="group flex items-start gap-3 px-2 py-1 -mx-2 rounded-lg hover:bg-accent/30 transition-colors"
              >
                <div
                  class="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0 mt-0.5 select-none"
                  :style="{ backgroundColor: group.color }"
                >
                  {{ group.username.slice(0, 2).toUpperCase() }}
                </div>

                <div class="flex-1 min-w-0">
                  <div class="flex items-baseline gap-2 mb-0.5">
                    <span class="text-sm font-semibold" :style="{ color: group.color }">
                      {{ group.username }}
                    </span>
                    <span class="text-[11px] text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity">
                      {{ formatTime(group.items[0].timestamp) }}
                    </span>
                  </div>

                  <div
                    v-for="item in group.items"
                    :key="item.id"
                    class="group/msg flex items-end gap-2"
                  >
                    <p class="text-sm leading-relaxed break-words flex-1 whitespace-pre-wrap">{{ item.text }}</p>
                    <span
                      v-if="group.items.length > 1"
                      class="text-[10px] text-muted-foreground opacity-0 group-hover/msg:opacity-100 transition-opacity flex-shrink-0 pb-px whitespace-nowrap"
                    >
                      {{ formatTime(item.timestamp) }}
                    </span>
                  </div>
                </div>
              </div>

            </template>
          </div>

          <!-- Input area -->
          <div class="px-4 pb-4 flex-shrink-0">
            <div class="h-5 flex items-center px-1 mb-1">
              <template v-if="typingUsers.length > 0">
                <span class="flex items-end gap-0.5 mr-2 pb-0.5">
                  <span v-for="i in 3" :key="i"
                    class="w-1 h-1 rounded-full bg-muted-foreground animate-bounce"
                    :style="{ animationDelay: (i - 1) * 150 + 'ms' }"
                  />
                </span>
                <span class="text-xs text-muted-foreground italic">{{ typingText }}</span>
              </template>
            </div>

            <div class="flex items-end gap-2 rounded-xl border border-border bg-background px-4 py-2 focus-within:ring-1 focus-within:ring-ring focus-within:border-ring transition-all">
              <textarea
                ref="textareaRef"
                v-model="messageInput"
                placeholder="Message #general"
                rows="1"
                class="flex-1 bg-transparent text-sm outline-none resize-none leading-6 max-h-32 py-0.5 placeholder:text-muted-foreground"
                @keydown="handleKeydown"
                @input="handleInputChange"
              />
              <Button
                size="icon"
                class="h-8 w-8 flex-shrink-0 mb-0.5"
                :disabled="!messageInput.trim()"
                @click="handleSend"
              >
                <Send class="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>

        </template>
      </main>

    </div>

    <!-- Search modal -->
    <SearchModal
      v-if="showSearch"
      @close="showSearch = false"
      @open-dm="(p) => { openDM(p); showSearch = false }"
      @open-group="(id) => { openGroup(id); showSearch = false }"
    />

    <!-- Create group modal -->
    <CreateGroupModal
      v-if="showCreateGroup"
      @close="showCreateGroup = false"
      @created="(g) => openGroup(g.id)"
    />

    <!-- New DM modal -->
    <NewDMModal
      v-if="showNewDM"
      @open-dm="openDM"
      @close="showNewDM = false"
    />

    <!-- Floating incoming call notification (when caller's DM is not currently open) -->
    <div
      v-if="callState === 'incoming' && activeDMPartner !== callPartner"
      class="fixed top-4 right-4 z-50 bg-background border border-border rounded-xl shadow-2xl p-4 flex items-center gap-3 min-w-[260px]"
    >
      <div
        class="w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
        :style="{ backgroundColor: usernameColor(callPartner ?? '') }"
      >
        {{ callPartner?.slice(0, 2).toUpperCase() }}
      </div>
      <div class="flex-1 min-w-0">
        <p class="text-sm font-semibold leading-tight truncate">{{ callPartner }}</p>
        <p class="text-xs text-muted-foreground leading-tight">Incoming video call…</p>
      </div>
      <button
        class="w-8 h-8 rounded-full bg-emerald-500 hover:bg-emerald-600 flex items-center justify-center transition-colors flex-shrink-0"
        title="Accept"
        @click="acceptCall(); openDM(callPartner)"
      >
        <Phone class="w-3.5 h-3.5 text-white" />
      </button>
      <button
        class="w-8 h-8 rounded-full bg-destructive hover:bg-destructive/90 flex items-center justify-center transition-colors flex-shrink-0"
        title="Decline"
        @click="rejectCall"
      >
        <PhoneOff class="w-3.5 h-3.5 text-white" />
      </button>
    </div>

  </TooltipProvider>
</template>
