<script setup>
import { ref, computed, watch, nextTick, onUnmounted } from 'vue'
import { useDMs } from '@/composables/useDMs'
import { useAuth } from '@/composables/useAuth'
import { useWebSocket } from '@/composables/useWebSocket'
import { dmTypingUsers, onlineStatuses } from '@/composables/useWebSocket'
import { usernameColor } from '@/utils/color'
import Button from '@/components/ui/button/Button.vue'
import { Send, Check, CheckCheck, CornerUpLeft, X, Paperclip, FileText, Video } from 'lucide-vue-next'
import { useVideoCall, callState, callPartner } from '@/composables/useVideoCall'
import VideoCallOverlay from './VideoCallOverlay.vue'

const props = defineProps({
  partner: { type: String, required: true },
})

const { username } = useAuth()
const { dmMessages, fetchMessages, sendDM, conversations } = useDMs()
const { sendDMTyping } = useWebSocket()
const { startCall, acceptCall, rejectCall } = useVideoCall()

const messageInput = ref('')
const textareaRef = ref(null)
const messagesContainer = ref(null)
const replyingTo = ref(null)
const fileInputRef = ref(null)
const pendingFile = ref(null)   // { url, name, type, size, previewUrl }
const uploadingFile = ref(false)

const partnerColor = computed(() => usernameColor(props.partner))
const messages = computed(() => dmMessages.value[props.partner] ?? [])
const isTyping = computed(() => dmTypingUsers.value[props.partner] === true)
const partnerStatus = computed(() => onlineStatuses.value[props.partner] ?? null)
const isPartnerOnline = computed(() => partnerStatus.value?.online ?? false)
const conversation = computed(() => conversations.value.find(c => c.partner === props.partner))

// Load messages when partner changes
watch(() => props.partner, async (p) => {
  if (p) await fetchMessages(p)
}, { immediate: true })

function scrollToBottom() {
  nextTick(() => {
    const el = messagesContainer.value
    if (el) el.scrollTop = el.scrollHeight
  })
}

watch(messages, scrollToBottom, { deep: true })
watch(() => props.partner, scrollToBottom)

// ── Typing indicator ──────────────────────────────────────────────────────
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
    if (!isTypingActive) { sendDMTyping(props.partner, true); isTypingActive = true }
    clearTimeout(typingDebounce)
    typingDebounce = setTimeout(() => { sendDMTyping(props.partner, false); isTypingActive = false }, 3000)
  } else {
    clearTimeout(typingDebounce)
    if (isTypingActive) { sendDMTyping(props.partner, false); isTypingActive = false }
  }
}

onUnmounted(() => {
  clearTimeout(typingDebounce)
  if (isTypingActive) sendDMTyping(props.partner, false)
})

// ── File upload ───────────────────────────────────────────────────────────
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
      headers: { Authorization: `Bearer ${useAuth().token.value}` },
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

// ── Send ──────────────────────────────────────────────────────────────────
async function handleSend() {
  const text = messageInput.value.trim()
  if (!text && !pendingFile.value) return
  clearTimeout(typingDebounce)
  if (isTypingActive) { sendDMTyping(props.partner, false); isTypingActive = false }
  const fileData = pendingFile.value ? { url: pendingFile.value.url, name: pendingFile.value.name, type: pendingFile.value.type, size: pendingFile.value.size } : null
  removePendingFile()
  try {
    await sendDM(props.partner, text, replyingTo.value, fileData)
  } catch { /* ignore */ }
  messageInput.value = ''
  replyingTo.value = null
  nextTick(() => {
    if (textareaRef.value) textareaRef.value.style.height = 'auto'
  })
}

function handleKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    handleSend()
  }
  if (e.key === 'Escape' && replyingTo.value) {
    replyingTo.value = null
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────
function formatTime(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function formatLastSeen(ts) {
  if (!ts) return 'Offline'
  const d = new Date(ts)
  const now = new Date()
  const diffMs = now - d
  if (diffMs < 60000) return 'Last seen just now'
  if (diffMs < 3600000) return `Last seen ${Math.floor(diffMs / 60000)}m ago`
  if (d.toDateString() === now.toDateString()) return `Last seen at ${formatTime(ts)}`
  return `Last seen ${d.toLocaleDateString([], { month: 'short', day: 'numeric' })}`
}

const isMine = (msg) => msg.from_user === username.value

const canSend = computed(() => !!messageInput.value.trim() || !!pendingFile.value)
</script>

<template>
  <div class="flex flex-col h-full overflow-hidden relative">

    <!-- Video call overlay (covers this DM view) -->
    <VideoCallOverlay
      v-if="callPartner === partner && (callState === 'calling' || callState === 'incoming' || callState === 'connected')"
    />

    <!-- Header -->
    <div class="h-12 px-4 flex items-center gap-3 border-b border-border flex-shrink-0">
      <div class="relative flex-shrink-0">
        <div
          class="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold"
          :style="{ backgroundColor: partnerColor }"
        >
          {{ partner.slice(0, 2).toUpperCase() }}
        </div>
        <div
          class="absolute -bottom-px -right-px w-2 h-2 rounded-full border border-background"
          :class="isPartnerOnline ? 'bg-emerald-500' : 'bg-muted-foreground/40'"
        />
      </div>
      <div class="min-w-0">
        <p class="text-sm font-semibold leading-tight">{{ partner }}</p>
        <p class="text-[10px] text-muted-foreground leading-tight">
          {{ isPartnerOnline ? 'Online' : formatLastSeen(partnerStatus?.lastSeen) }}
        </p>
      </div>
      <!-- Video call button -->
      <button
        v-if="isPartnerOnline && callState === 'idle'"
        class="ml-auto p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
        title="Start video call"
        @click="startCall(partner)"
      >
        <Video class="w-4 h-4" />
      </button>
    </div>

    <!-- Messages -->
    <div ref="messagesContainer" class="flex-1 overflow-y-auto px-4 py-4 space-y-1">

      <div v-if="messages.length === 0" class="flex flex-col items-center justify-center h-40 text-muted-foreground">
        <div
          class="w-12 h-12 rounded-full flex items-center justify-center text-white text-base font-bold mb-3"
          :style="{ backgroundColor: partnerColor }"
        >
          {{ partner.slice(0, 2).toUpperCase() }}
        </div>
        <p class="text-sm font-medium">{{ partner }}</p>
        <p class="text-xs opacity-60 mt-1">Send a message to start the conversation</p>
      </div>

      <div
        v-for="msg in messages"
        :key="msg.id"
        class="flex gap-2"
        :class="isMine(msg) ? 'flex-row-reverse' : 'flex-row'"
      >
        <!-- Avatar (partner only) -->
        <div
          v-if="!isMine(msg)"
          class="w-7 h-7 rounded-full flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0 mt-auto mb-0.5"
          :style="{ backgroundColor: partnerColor }"
        >
          {{ partner.slice(0, 2).toUpperCase() }}
        </div>

        <div class="max-w-[70%] group/msg" :class="isMine(msg) ? 'items-end' : 'items-start'" style="display:flex;flex-direction:column">

          <!-- Reply quote -->
          <div
            v-if="msg.reply_to_id"
            class="mb-1 px-2 py-1 rounded-md border-l-2 text-xs opacity-70"
            :class="isMine(msg)
              ? 'border-violet-400 bg-violet-500/10 text-violet-200'
              : 'border-muted-foreground bg-muted/60'"
          >
            <span class="font-semibold">{{ msg.reply_to_username }}</span>
            <p class="truncate opacity-80">{{ msg.reply_to_text }}</p>
          </div>

          <!-- Bubble -->
          <div class="flex items-end gap-1.5" :class="isMine(msg) ? 'flex-row-reverse' : 'flex-row'">

            <!-- Reply button (hover) -->
            <button
              class="opacity-0 group-hover/msg:opacity-100 transition-opacity p-1 rounded-md hover:bg-accent text-muted-foreground"
              title="Reply"
              @click="replyingTo = msg"
            >
              <CornerUpLeft class="w-3 h-3" />
            </button>

            <div
              class="rounded-2xl text-sm leading-relaxed break-words max-w-full overflow-hidden"
              :class="isMine(msg)
                ? 'bg-violet-600 text-white rounded-tr-sm'
                : 'bg-muted text-foreground rounded-tl-sm'"
            >
              <!-- File attachment -->
              <div v-if="msg.file_url" class="p-1">
                <img
                  v-if="msg.file_type?.startsWith('image/')"
                  :src="msg.file_url"
                  :alt="msg.file_name"
                  class="max-w-[280px] max-h-64 rounded-xl object-contain block"
                />
                <video
                  v-else-if="msg.file_type?.startsWith('video/')"
                  :src="msg.file_url"
                  controls
                  class="max-w-[280px] max-h-64 rounded-xl block"
                />
                <a
                  v-else
                  :href="msg.file_url"
                  :download="msg.file_name"
                  class="flex items-center gap-2 px-3 py-2 rounded-xl hover:opacity-80 transition-opacity"
                  :class="isMine(msg) ? 'bg-violet-500/40' : 'bg-background/50'"
                >
                  <FileText class="w-4 h-4 flex-shrink-0" />
                  <div class="min-w-0">
                    <p class="text-xs font-medium truncate max-w-[200px]">{{ msg.file_name }}</p>
                    <p class="text-[10px] opacity-60">{{ formatFileSize(msg.file_size) }}</p>
                  </div>
                </a>
              </div>
              <!-- Text -->
              <p v-if="msg.text" class="px-3 py-2 whitespace-pre-wrap" :class="{ 'pt-0': msg.file_url }">{{ msg.text }}</p>
            </div>
          </div>

          <!-- Time + status -->
          <div class="flex items-center gap-1 mt-0.5 px-1" :class="isMine(msg) ? 'flex-row-reverse' : 'flex-row'">
            <span class="text-[10px] text-muted-foreground opacity-0 group-hover/msg:opacity-100 transition-opacity">
              {{ formatTime(msg.timestamp) }}
            </span>
            <!-- Status ticks (own messages only) -->
            <span v-if="isMine(msg)" class="flex-shrink-0">
              <CheckCheck
                v-if="msg.status === 'read'"
                class="w-3 h-3 text-blue-400"
              />
              <CheckCheck
                v-else-if="msg.status === 'delivered'"
                class="w-3 h-3 text-muted-foreground"
              />
              <Check
                v-else
                class="w-3 h-3 text-muted-foreground/60"
              />
            </span>
          </div>
        </div>
      </div>

      <!-- Typing indicator -->
      <div v-if="isTyping" class="flex items-center gap-2 py-1">
        <div
          class="w-7 h-7 rounded-full flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0"
          :style="{ backgroundColor: partnerColor }"
        >
          {{ partner.slice(0, 2).toUpperCase() }}
        </div>
        <div class="bg-muted rounded-2xl rounded-tl-sm px-3 py-2 flex items-center gap-1">
          <span
            v-for="i in 3"
            :key="i"
            class="w-1.5 h-1.5 rounded-full bg-muted-foreground animate-bounce"
            :style="{ animationDelay: (i - 1) * 150 + 'ms' }"
          />
        </div>
      </div>

    </div>

    <!-- Reply quote bar -->
    <div v-if="replyingTo" class="px-4 py-2 border-t border-border bg-muted/30 flex items-center gap-2">
      <div class="flex-1 min-w-0 border-l-2 border-violet-500 pl-2">
        <p class="text-xs font-semibold text-violet-500">{{ replyingTo.from_user }}</p>
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
        <textarea
          ref="textareaRef"
          v-model="messageInput"
          :placeholder="`Message ${partner}`"
          rows="1"
          class="flex-1 bg-transparent text-sm outline-none resize-none leading-6 max-h-32 py-0.5 placeholder:text-muted-foreground"
          @keydown="handleKeydown"
          @input="handleInputChange"
        />
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
</template>
