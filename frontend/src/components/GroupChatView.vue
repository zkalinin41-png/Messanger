<script setup>
import { ref, computed, watch, nextTick, onUnmounted } from 'vue'
import { useWebSocket, groupTypingUsers } from '@/composables/useWebSocket'
import { useGroups } from '@/composables/useGroups'
import { useAuth } from '@/composables/useAuth'
import GroupMembersPanel from './GroupMembersPanel.vue'
import Button from '@/components/ui/button/Button.vue'
import { Hash, Users, Send, MessageCircle, CornerUpLeft, X, Paperclip, FileText } from 'lucide-vue-next'

const props = defineProps({ groupId: { type: Number, required: true } })

const { sendGroupMessage, sendGroupTyping } = useWebSocket()
const { groups, groupMessages, groupMembers, fetchGroupDetails } = useGroups()
const { username } = useAuth()

const messageInput = ref('')
const textareaRef = ref(null)
const messagesContainer = ref(null)
const showMembers = ref(false)
const replyingTo = ref(null)
const fileInputRef = ref(null)
const pendingFile = ref(null)   // { url, name, type, size, previewUrl }
const uploadingFile = ref(false)

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

// Discord-style message grouping — replies always break the group
const messageGroups = computed(() => {
  const result = []
  for (const msg of messages.value) {
    const prev = result[result.length - 1]
    const canMerge =
      prev &&
      prev.username === msg.username &&
      !msg.reply_to_id &&
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
      })
    }
  }
  return result
})

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

      <!-- Messages -->
      <div ref="messagesContainer" class="flex-1 overflow-y-auto px-4 py-4">

        <div v-if="messages.length === 0" class="flex flex-col items-center justify-center h-40 text-muted-foreground">
          <MessageCircle class="w-10 h-10 mb-2 opacity-20" />
          <p class="text-sm">No messages yet — say something!</p>
        </div>

        <div
          v-for="group in messageGroups"
          :key="group.id"
          class="group flex items-start gap-3 px-2 py-1 -mx-2 rounded-lg hover:bg-accent/30 transition-colors"
        >
          <!-- Avatar -->
          <div
            class="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0 mt-0.5 select-none"
            :style="{ backgroundColor: group.color }"
          >
            {{ group.username.slice(0, 2).toUpperCase() }}
          </div>

          <div class="flex-1 min-w-0">
            <!-- Username + timestamp -->
            <div class="flex items-baseline gap-2 mb-0.5">
              <span class="text-sm font-semibold" :style="{ color: group.color }">
                {{ group.username }}
              </span>
              <span class="text-[11px] text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity">
                {{ formatTime(group.items[0].timestamp) }}
              </span>
            </div>

            <!-- Messages in group -->
            <div
              v-for="item in group.items"
              :key="item.id"
              class="group/msg"
            >
              <!-- Reply quote -->
              <div
                v-if="item.reply_to_id"
                class="mb-0.5 flex items-start gap-1.5 pl-1 border-l-2 border-muted-foreground/30 opacity-70 hover:opacity-100 transition-opacity"
              >
                <span class="text-xs font-semibold" :style="{ color: group.color }">{{ item.reply_to_username }}</span>
                <p class="text-xs text-muted-foreground truncate">{{ item.reply_to_text || '📎 File' }}</p>
              </div>

              <div class="flex items-end gap-2">
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
                  <p v-if="item.text" class="text-sm leading-relaxed break-words whitespace-pre-wrap">{{ item.text }}</p>
                </div>
                <div class="flex items-center gap-1 opacity-0 group-hover/msg:opacity-100 transition-opacity flex-shrink-0">
                  <span
                    v-if="group.items.length > 1"
                    class="text-[10px] text-muted-foreground pb-px whitespace-nowrap"
                  >
                    {{ formatTime(item.timestamp) }}
                  </span>
                  <button
                    class="p-0.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground"
                    title="Reply"
                    @click="replyingTo = { id: item.id, text: item.text || '', file_name: item.file_name, username: group.username, from_user: group.username }"
                  >
                    <CornerUpLeft class="w-3 h-3" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

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
        <textarea
          ref="textareaRef"
          v-model="messageInput"
          :placeholder="`Message #${group?.name ?? '…'}`"
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
