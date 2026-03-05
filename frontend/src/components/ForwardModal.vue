<script setup>
import { ref, computed, onMounted } from 'vue'
import { useAuth } from '@/composables/useAuth'
import { useGroups } from '@/composables/useGroups'
import { useDMs } from '@/composables/useDMs'
import { usernameColor } from '@/utils/color'
import { X, Send, Hash, MessageCircle } from 'lucide-vue-next'

const props = defineProps({
  messageId: { type: Number, required: true },
  messageType: { type: String, required: true },
})
const emit = defineEmits(['close', 'forwarded'])

const { token } = useAuth()
const { groups } = useGroups()
const { conversations } = useDMs()

const sending = ref(false)
const selected = ref(null) // { type: 'dm', partner } or { type: 'group', id }

async function handleForward() {
  if (!selected.value) return
  sending.value = true
  try {
    const body = {
      messageId: props.messageId,
      messageType: props.messageType,
    }
    if (selected.value.type === 'dm') body.toPartner = selected.value.partner
    else body.toGroupId = selected.value.id

    await fetch('/api/forward', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token.value}` },
      body: JSON.stringify(body),
    })
    emit('forwarded')
    emit('close')
  } catch (err) {
    console.error('Forward error:', err)
  } finally {
    sending.value = false
  }
}
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50" @click.self="$emit('close')">
    <div class="w-full max-w-sm bg-popover border border-border rounded-xl shadow-2xl overflow-hidden">
      <!-- Header -->
      <div class="flex items-center justify-between px-4 py-3 border-b border-border">
        <h3 class="text-sm font-semibold">Forward message to…</h3>
        <button class="p-1 rounded hover:bg-accent text-muted-foreground" @click="$emit('close')">
          <X class="w-3.5 h-3.5" />
        </button>
      </div>

      <!-- Conversation list -->
      <div class="max-h-[50vh] overflow-y-auto py-1">
        <!-- DMs -->
        <p v-if="conversations.length > 0" class="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest px-4 py-1">Direct Messages</p>
        <button
          v-for="conv in conversations"
          :key="'dm-' + conv.partner"
          class="w-full px-4 py-2 flex items-center gap-3 hover:bg-accent/60 transition-colors"
          :class="selected?.type === 'dm' && selected.partner === conv.partner ? 'bg-accent' : ''"
          @click="selected = { type: 'dm', partner: conv.partner }"
        >
          <div
            class="w-6 h-6 rounded-full flex items-center justify-center text-white text-[9px] font-bold"
            :style="{ backgroundColor: usernameColor(conv.partner) }"
          >
            {{ conv.partner.slice(0, 2).toUpperCase() }}
          </div>
          <span class="text-sm">{{ conv.partner }}</span>
        </button>

        <!-- Groups -->
        <p v-if="groups.length > 0" class="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest px-4 py-1 mt-2">Groups</p>
        <button
          v-for="g in groups"
          :key="'g-' + g.id"
          class="w-full px-4 py-2 flex items-center gap-3 hover:bg-accent/60 transition-colors"
          :class="selected?.type === 'group' && selected.id === g.id ? 'bg-accent' : ''"
          @click="selected = { type: 'group', id: g.id }"
        >
          <div class="w-6 h-6 rounded-full bg-muted flex items-center justify-center">
            <Hash class="w-3 h-3 text-muted-foreground" />
          </div>
          <span class="text-sm">{{ g.name }}</span>
        </button>
      </div>

      <!-- Footer -->
      <div class="px-4 py-3 border-t border-border flex justify-end">
        <button
          class="px-4 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
          :class="selected ? 'bg-violet-600 text-white hover:bg-violet-700' : 'bg-muted text-muted-foreground cursor-not-allowed'"
          :disabled="!selected || sending"
          @click="handleForward"
        >
          <Send class="w-3.5 h-3.5" />
          {{ sending ? 'Sending…' : 'Forward' }}
        </button>
      </div>
    </div>
  </div>
</template>
