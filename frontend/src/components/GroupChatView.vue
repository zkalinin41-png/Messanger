<script setup lang="ts">
import { ref, computed, watch, nextTick, onUnmounted } from 'vue'
import { useWebSocket, groupTypingUsers } from '@/composables/useWebSocket'
import { useGroups } from '@/composables/useGroups'
import { useAuth } from '@/composables/useAuth'
import GroupMembersPanel from './GroupMembersPanel.vue'
import MessageActions from '@/components/MessageActions.vue'
import MessageReactions from '@/components/MessageReactions.vue'
import AudioRecorder from '@/components/AudioRecorder.vue'
import ForwardModal from '@/components/ForwardModal.vue'
import EmojiPicker from '@/components/EmojiPicker.vue'
import Button from '@/components/ui/button/Button.vue'
import { Hash, Users, Send, MessageCircle, X, Paperclip, FileText, Ban, Pin } from 'lucide-vue-next'

const props = defineProps({ groupId: { type: Number, required: true } })

const { sendGroupMessage, sendGroupTyping } = useWebSocket()
const { groups, groupMessages, groupMembers, fetchGroupDetails } = useGroups()
const { username, token } = useAuth()

const messageInput = ref('')
const textareaRef = ref(null)
const messagesContainer = ref(null)
const showMembers = ref(false)
const replyingTo = ref(null)
const fileInputRef = ref(null)
const pendingFile = ref(null)
const uploadingFile = ref(false)
const editingMsg = ref(null)
const editText = ref('')
const forwardingMsg = ref(null)
const pinnedMessages = ref([])
const showPins = ref(false)

const group = computed(() => groups.value.find(g => g.id === props.groupId))
const messages = computed(() => groupMessages.value[props.groupId] ?? [])
const members = computed(() => groupMembers.value[props.groupId] ?? [])
const myRole = computed(() => members.value.find(m => m.username === username.value)?.role ?? 'member')

const typingList = computed(() => groupTypingUsers.value[props.groupId] ?? [])
const typingText = computed(() => {
  const t = typingList.value.filter(u => u !== username.value)
  if (t.length === 0) return ''
  if (t.length === 1) return `${t[0]} is typing…`
  if (t.length === 2) return `${t[0]} and ${t[1]} are typing…`
  return 'Several people are typing…'
})

// Fetch member list when panel opens
watch(showMembers, (v) => {
  if (v) fetchGroupDetails(props.groupId)
})

// Reset edit mode when switching groups
watch(() => props.groupId, () => { editingMsg.value = null; fetchPins() }, { immediate: true })

async function fetchPins() {
  try {
    const res = await fetch(`/api/groups/${props.groupId}/pins`, { headers: { Authorization: `Bearer ${token.value}` } })
    const data = await res.json()
    pinnedMessages.value = data.pins || []
  } catch { pinnedMessages.value = [] }
}

async function pinMessage(msg) {
  try {
    await fetch(`/api/groups/${props.groupId}/pins/${msg.id}`, { method: 'POST', headers: { Authorization: `Bearer ${token.value}` } })
    fetchPins()
  } catch (err) { console.error('Pin error:', err) }
}

async function unpinMessage(id) {
  try {
    await fetch(`/api/groups/${props.groupId}/pins/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token.value}` } })
    fetchPins()
  } catch (err) { console.error('Unpin error:', err) }
}

// Discord-style message grouping
const messageGroups = computed(() => {
  const result = []
  for (const msg of messages.value) {
    const prev = result[result.length - 1]
    const canMerge =
      prev &&
      prev.username === msg.username &&
      !msg.reply_to_id &&
      !msg.deleted &&
      !(prev.items[prev.items.length - 1]?.deleted) &&
      msg.timestamp - prev.lastTimestamp < 5 * 60 * 1000
    if (canMerge) {
      prev.items.push(msg)
      prev.lastTimestamp = msg.timestamp
    } else {
      result.push({
        id: msg.id,
        username: msg.username,
        color: msg.color,
        items: [msg],
        lastTimestamp: msg.timestamp,
        firstTimestamp: msg.timestamp,
      })
    }
  }
  return result
})

function formatTime(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function formatDateSep(ts) {
  const d = new Date(ts)
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const yesterday = new Date(today - 86400000)
  const msgDay = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  if (msgDay.getTime() === today.getTime()) return 'Today'
  if (msgDay.getTime() === yesterday.getTime()) return 'Yesterday'
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined })
}

function shouldShowDateSep(idx) {
  if (idx === 0) return true
  const prev = messageGroups.value[idx - 1]
  const curr = messageGroups.value[idx]
  return new Date(prev.firstTimestamp).toDateString() !== new Date(curr.firstTimestamp).toDateString()
}

function scrollToBottom() {
  nextTick(() => {
    const el = messagesContainer.value
    if (el) el.scrollTop = el.scrollHeight
  })
}

watch(messages, scrollToBottom, { deep: true })
watch(() => props.groupId, scrollToBottom)

// ── Typing ──────────────────────────────────────────────────────────────────
let typingDebounce = null
let isTypingActive = false

function handleInputChange() {
  nextTick(() => {
    const el = textareaRef.value
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 128) + 'px'
  })
  if (messageInput.value.trim()) {
    if (!isTypingActive) { sendGroupTyping(props.groupId, true); isTypingActive = true }
    clearTimeout(typingDebounce)
    typingDebounce = setTimeout(() => { sendGroupTyping(props.groupId, false); isTypingActive = false }, 3000)
  } else {
    clearTimeout(typingDebounce)
    if (isTypingActive) { sendGroupTyping(props.groupId, false); isTypingActive = false }
  }
}

onUnmounted(() => {
  clearTimeout(typingDebounce)
  if (isTypingActive) sendGroupTyping(props.groupId, false)
})

// ── File upload ──────────────────────────────────────────────────────────
async function handleFileSelect(e) {
  const file = e.target.files?.[0]
  if (!fileInputRef.value) return
  fileInputRef.value.value = ''
  if (!file) return
  uploadingFile.value = true
  try {
    const form = new FormData()
    form.append('file', file)
    const res = await fetch('/api/upload', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token.value}` },
      body: form,
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || 'Upload failed')
    const previewUrl = file.type.startsWith('image/') ? URL.createObjectURL(file) : null
    pendingFile.value = { url: data.url, name: data.name, type: data.type, size: data.size, previewUrl }
  } catch (err) {
    console.error('Upload error:', err)
  } finally {
    uploadingFile.value = false
  }
}

function removePendingFile() {
  if (pendingFile.value?.previewUrl) URL.revokeObjectURL(pendingFile.value.previewUrl)
  pendingFile.value = null
}

function formatFileSize(bytes) {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// ── Edit / Delete ─────────────────────────────────────────────────────────
function startEdit(msg) {
  editingMsg.value = msg
  editText.value = msg.text
}

function cancelEdit() {
  editingMsg.value = null
  editText.value = ''
}

async function saveEdit() {
  if (!editingMsg.value || !editText.value.trim()) return
  try {
    await fetch(`/api/groups/${props.groupId}/messages/${editingMsg.value.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token.value}` },
      body: JSON.stringify({ text: editText.value.trim() }),
    })
  } catch (err) { console.error('Edit error:', err) }
  cancelEdit()
}

async function deleteMessage(msg) {
  if (!confirm('Delete this message?')) return
  try {
    await fetch(`/api/groups/${props.groupId}/messages/${msg.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token.value}` },
    })
  } catch (err) { console.error('Delete error:', err) }
}

async function toggleReaction({ messageId, emoji, messageType }) {
  try {
    await fetch('/api/reactions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token.value}` },
      body: JSON.stringify({ messageId, messageType: messageType || 'group', emoji }),
    })
  } catch (err) { console.error('Reaction error:', err) }
}

// ── Send ────────────────────────────────────────────────────────────────────
function handleSend() {
  const text = messageInput.value.trim()
  if (!text && !pendingFile.value) return
  clearTimeout(typingDebounce)
  if (isTypingActive) { sendGroupTyping(props.groupId, false); isTypingActive = false }
  const fileData = pendingFile.value ? { url: pendingFile.value.url, name: pendingFile.value.name, type: pendingFile.value.type, size: pendingFile.value.size } : null
  removePendingFile()
  sendGroupMessage(props.groupId, text, replyingTo.value, fileData)
  messageInput.value = ''
  replyingTo.value = null
  nextTick(() => {
    if (textareaRef.value) textareaRef.value.style.height = 'auto'
  })
}

const canSend = computed(() => !!messageInput.value.trim() || !!pendingFile.value)

function handleKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    handleSend()
  }
  if (e.key === 'Escape' && replyingTo.value) {
    replyingTo.value = null
  }
}

const isMine = (name) => name === username.value
</script>

<template>
  <div class="flex flex-col h-full overflow-hidden">

    <!-- Header -->
    <div class="h-12 px-4 flex items-center gap-2 border-b border-border flex-shrink-0">
      <Hash class="w-4 h-4 text-muted-foreground flex-shrink-0" />
      <span class="font-semibold text-sm truncate">{{ group?.name ?? '…' }}</span>
      <span v-if="group?.description" class="text-xs text-muted-foreground truncate hidden sm:block">
        — {{ group.description }}
      </span>
      <div class="ml-auto flex-shrink-0">
        <button
          class="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs transition-colors"
          :class="showMembers ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent hover:text-foreground'"
          @click="showMembers = !showMembers"
        >
          <Users class="w-3.5 h-3.5" />
          <span>{{ group?.member_count ?? '…' }}</span>
        </button>
      </div>
    </div>

    <!-- Body: messages + optional members panel -->
    <div class="flex flex-1 overflow-hidden">

      <!-- Pinned messages bar -->
      <div v-if="pinnedMessages.length > 0" class="px-4 py-1.5 border-b border-border bg-muted/30 flex items-center gap-2">
        <Pin class="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
        <button class="text-xs text-muted-foreground hover:text-foreground transition-colors truncate flex-1 text-left" @click="showPins = !showPins">
          {{ pinnedMessages.length }} pinned message{{ pinnedMessages.length > 1 ? 's' : '' }}
        </button>
      </div>

      <!-- Pinned messages panel -->
      <div v-if="showPins && pinnedMessages.length > 0" class="border-b border-border bg-muted/20 max-h-32 overflow-y-auto px-4 py-2 space-y-1">
        <div v-for="pin in pinnedMessages" :key="pin.id" class="flex items-center gap-2 text-xs">
          <span class="font-semibold" :style="{ color: pin.color }">{{ pin.username }}</span>
          <span class="text-muted-foreground truncate flex-1">{{ pin.text || '📎 File' }}</span>
          <button class="text-[10px] text-muted-foreground hover:text-destructive" @click="unpinMessage(pin.message_id)">Unpin</button>
        </div>
      </div>

      <!-- Messages -->
      <div ref="messagesContainer" class="flex-1 overflow-y-auto px-4 py-4">

        <div v-if="messages.length === 0" class="flex flex-col items-center justify-center h-40 text-muted-foreground">
          <MessageCircle class="w-10 h-10 mb-2 opacity-20" />
          <p class="text-sm">No messages yet — say something!</p>
        </div>

        <template v-for="(grp, gIdx) in messageGroups" :key="grp.id">
          <!-- Date separator -->
          <div v-if="shouldShowDateSep(gIdx)" class="flex items-center gap-3 py-3">
            <div class="flex-1 h-px bg-border" />
            <span class="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">{{ formatDateSep(grp.firstTimestamp) }}</span>
            <div class="flex-1 h-px bg-border" />
          </div>

          <div
            class="group flex items-start gap-3 px-2 py-1 -mx-2 rounded-lg hover:bg-accent/30 transition-colors"
          >
            <!-- Avatar -->
            <div
              class="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0 mt-0.5 select-none"
              :style="{ backgroundColor: grp.color }"
            >
              {{ grp.username.slice(0, 2).toUpperCase() }}
            </div>

            <div class="flex-1 min-w-0">
              <!-- Username + timestamp -->
              <div class="flex items-baseline gap-2 mb-0.5">
                <span class="text-sm font-semibold" :style="{ color: grp.color }">
                  {{ grp.username }}
                </span>
                <span class="text-[11px] text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity">
                  {{ formatTime(grp.items[0].timestamp) }}
                </span>
              </div>

              <!-- Messages in group -->
              <div
                v-for="item in grp.items"
                :key="item.id"
                class="group/msg"
              >
                <!-- Reply quote -->
                <div
                  v-if="item.reply_to_id"
                  class="mb-0.5 flex items-start gap-1.5 pl-1 border-l-2 border-muted-foreground/30 opacity-70 hover:opacity-100 transition-opacity"
                >
                  <span class="text-xs font-semibold" :style="{ color: grp.color }">{{ item.reply_to_username }}</span>
                  <p class="text-xs text-muted-foreground truncate">{{ item.reply_to_text || '📎 File' }}</p>
                </div>

                <!-- Deleted message -->
                <div v-if="item.deleted" class="flex items-center gap-1 py-0.5 text-sm italic opacity-40 text-muted-foreground">
                  <Ban class="w-3 h-3" />
                  Message deleted
                </div>

                <!-- Edit mode -->
                <div v-else-if="editingMsg?.id === item.id" class="flex flex-col gap-1 max-w-md">
                  <textarea
                    v-model="editText"
                    class="rounded-xl border border-violet-500 bg-background px-3 py-2 text-sm outline-none resize-none leading-relaxed"
                    rows="2"
                    @keydown.enter.prevent="saveEdit"
                    @keydown.escape="cancelEdit"
                  />
                  <div class="flex gap-1 justify-end">
                    <button class="text-[10px] px-2 py-0.5 rounded text-muted-foreground hover:text-foreground" @click="cancelEdit">Cancel</button>
                    <button class="text-[10px] px-2 py-0.5 rounded bg-violet-600 text-white hover:bg-violet-700" @click="saveEdit">Save</button>
                  </div>
                </div>

                <!-- Normal message content -->
                <div v-else class="flex items-end gap-2">
                  <div class="flex-1 min-w-0">
                    <!-- File attachment -->
                    <div v-if="item.file_url" class="mb-1">
                      <img
                        v-if="item.file_type?.startsWith('image/')"
                        :src="item.file_url"
                        :alt="item.file_name"
                        class="max-w-[320px] max-h-64 rounded-xl object-contain block"
                      />
                      <video
                        v-else-if="item.file_type?.startsWith('video/')"
                        :src="item.file_url"
                        controls
                        class="max-w-[320px] max-h-64 rounded-xl block"
                      />
                      <audio
                        v-else-if="item.file_type?.startsWith('audio/')"
                        :src="item.file_url"
                        controls
                        class="max-w-[280px] rounded-xl block"
                      />
                      <a
                        v-else
                        :href="item.file_url"
                        :download="item.file_name"
                        class="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-muted/60 hover:bg-muted transition-colors max-w-[320px]"
                      >
                        <FileText class="w-4 h-4 flex-shrink-0 text-muted-foreground" />
                        <div class="min-w-0">
                          <p class="text-xs font-medium truncate">{{ item.file_name }}</p>
                          <p class="text-[10px] text-muted-foreground">{{ formatFileSize(item.file_size) }}</p>
                        </div>
                      </a>
                    </div>
                    <p v-if="item.text" class="text-sm leading-relaxed break-words whitespace-pre-wrap">
                      {{ item.text }}
                      <span v-if="item.edited" class="text-[9px] text-muted-foreground/50 italic ml-1">(edited)</span>
                    </p>
                  </div>
                  <div class="flex items-center gap-0.5 opacity-0 group-hover/msg:opacity-100 transition-opacity flex-shrink-0">
                    <span
                      v-if="grp.items.length > 1"
                      class="text-[10px] text-muted-foreground pb-px whitespace-nowrap"
                    >
                      {{ formatTime(item.timestamp) }}
                    </span>
                    <MessageActions
                      :msg="{ ...item, username: grp.username }"
                      :is-mine="isMine(grp.username)"
                      message-type="group"
                      :show-pin="true"
                      @reply="replyingTo = { id: item.id, text: item.text || '', file_name: item.file_name, username: grp.username, from_user: grp.username }"
                      @edit="startEdit"
                      @delete="deleteMessage"
                      @react="toggleReaction"
                      @forward="(m) => forwardingMsg = m"
                      @pin="pinMessage"
                    />
                  </div>
                </div>

                <!-- Reactions -->
                <MessageReactions
                  v-if="!item.deleted"
                  :reactions="item.reactions || []"
                  :message-id="item.id"
                  message-type="group"
                  @react="toggleReaction"
                />
              </div>
            </div>
          </div>
        </template>

        <!-- Group typing indicator -->
        <div v-if="typingText" class="flex items-center gap-2 px-2 py-1 mt-1">
          <span class="flex items-end gap-0.5">
            <span v-for="i in 3" :key="i"
              class="w-1 h-1 rounded-full bg-muted-foreground animate-bounce"
              :style="{ animationDelay: (i - 1) * 150 + 'ms' }"
            />
          </span>
          <span class="text-xs text-muted-foreground italic">{{ typingText }}</span>
        </div>

      </div>

      <!-- Members panel -->
      <GroupMembersPanel
        v-if="showMembers"
        :group-id="groupId"
        :members="members"
        :my-role="myRole"
        :group="group"
        @close="showMembers = false"
      />
    </div>

    <!-- Reply quote bar -->
    <div v-if="replyingTo" class="px-4 py-2 border-t border-border bg-muted/30 flex items-center gap-2">
      <div class="flex-1 min-w-0 border-l-2 border-violet-500 pl-2">
        <p class="text-xs font-semibold text-violet-500">{{ replyingTo.username }}</p>
        <p class="text-xs text-muted-foreground truncate">{{ replyingTo.text || (replyingTo.file_name ? `📎 ${replyingTo.file_name}` : '') }}</p>
      </div>
      <button class="p-1 rounded-md hover:bg-accent text-muted-foreground flex-shrink-0" @click="replyingTo = null">
        <X class="w-3.5 h-3.5" />
      </button>
    </div>

    <!-- Pending file preview bar -->
    <div v-if="pendingFile || uploadingFile" class="px-4 py-2 border-t border-border bg-muted/30 flex items-center gap-2">
      <div v-if="uploadingFile" class="flex items-center gap-2 text-xs text-muted-foreground">
        <div class="w-3.5 h-3.5 rounded-full border-2 border-muted-foreground border-t-transparent animate-spin" />
        Uploading…
      </div>
      <template v-else-if="pendingFile">
        <img v-if="pendingFile.previewUrl" :src="pendingFile.previewUrl" class="h-10 w-10 rounded object-cover flex-shrink-0" />
        <FileText v-else class="w-4 h-4 flex-shrink-0 text-muted-foreground" />
        <div class="flex-1 min-w-0">
          <p class="text-xs font-medium truncate">{{ pendingFile.name }}</p>
          <p class="text-[10px] text-muted-foreground">{{ formatFileSize(pendingFile.size) }}</p>
        </div>
        <button class="p-1 rounded-md hover:bg-accent text-muted-foreground flex-shrink-0" @click="removePendingFile">
          <X class="w-3.5 h-3.5" />
        </button>
      </template>
    </div>

    <!-- Input area -->
    <div class="px-4 pb-4 pt-2 flex-shrink-0">
      <input ref="fileInputRef" type="file" class="hidden" @change="handleFileSelect" />
      <div class="flex items-end gap-2 rounded-xl border border-border bg-background px-3 py-2 focus-within:ring-1 focus-within:ring-ring focus-within:border-ring transition-all">
        <button
          class="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors flex-shrink-0 mb-0.5"
          title="Attach file"
          @click="fileInputRef?.click()"
        >
          <Paperclip class="w-4 h-4" />
        </button>
        <EmojiPicker @select="(e) => { messageInput += e }" />
        <textarea
          ref="textareaRef"
          v-model="messageInput"
          :placeholder="`Message #${group?.name ?? '…'}`"
          rows="1"
          class="flex-1 bg-transparent text-sm outline-none resize-none leading-6 max-h-32 py-0.5 placeholder:text-muted-foreground"
          @keydown="handleKeydown"
          @input="handleInputChange"
        />
        <AudioRecorder @recorded="(file) => { pendingFile = file; handleSend() }" />
        <Button
          size="icon"
          class="h-8 w-8 flex-shrink-0 mb-0.5"
          :disabled="!canSend || uploadingFile"
          @click="handleSend"
        >
          <Send class="w-3.5 h-3.5" />
        </Button>
      </div>
    </div>

  </div>

  <!-- Forward modal -->
  <ForwardModal
    v-if="forwardingMsg"
    :message-id="forwardingMsg.id"
    message-type="group"
    @close="forwardingMsg = null"
    @forwarded="forwardingMsg = null"
  />
</template>
