<script setup lang="ts">
import { useAuth } from '@/composables/useAuth'

const props = defineProps({
  reactions: { type: Array, default: () => [] },
  messageId: { type: Number, required: true },
  messageType: { type: String, default: 'dm' },
})

const emit = defineEmits(['react'])
const { username } = useAuth()

function hasReacted(reaction) {
  return reaction.users.includes(username.value)
}
</script>

<template>
  <div v-if="reactions && reactions.length > 0" class="flex flex-wrap gap-1 mt-1 px-1">
    <button
      v-for="r in reactions"
      :key="r.emoji"
      class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-xs border transition-colors"
      :class="hasReacted(r) ? 'bg-violet-500/20 border-violet-500/40 text-violet-300' : 'bg-muted/50 border-border text-muted-foreground hover:bg-accent'"
      @click="$emit('react', { messageId, emoji: r.emoji, messageType })"
    >
      <span>{{ r.emoji }}</span>
      <span class="text-[10px] font-medium">{{ r.users.length }}</span>
    </button>
  </div>
</template>
