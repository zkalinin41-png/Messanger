<script setup lang="ts">
import { ref } from 'vue'
import { Pencil, Trash2, SmilePlus, CornerUpLeft, Forward, Pin, Copy } from 'lucide-vue-next'

const props = defineProps({
  msg: { type: Object, required: true },
  isMine: { type: Boolean, default: false },
  messageType: { type: String, default: 'dm' },
  showPin: { type: Boolean, default: false },
})

const emit = defineEmits(['edit', 'delete', 'react', 'reply', 'forward', 'pin'])

const EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🔥', '👏', '🎉']
const showEmojiPicker = ref(false)
const copied = ref(false)

function handleReact(emoji) {
  showEmojiPicker.value = false
  emit('react', { messageId: props.msg.id, emoji, messageType: props.messageType })
}

function copyText() {
  if (!props.msg.text) return
  navigator.clipboard.writeText(props.msg.text).then(() => {
    copied.value = true
    setTimeout(() => { copied.value = false }, 1500)
  })
}
</script>

<template>
  <div class="flex items-center bg-background border border-border rounded-md shadow-sm px-0.5 py-0.5 gap-0">
    <!-- Reply -->
    <button
      class="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
      title="Reply"
      @click="$emit('reply', msg)"
    >
      <CornerUpLeft class="w-3 h-3" />
    </button>

    <!-- Emoji react -->
    <div class="relative">
      <button
        class="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
        title="React"
        @click="showEmojiPicker = !showEmojiPicker"
      >
        <SmilePlus class="w-3 h-3" />
      </button>
      <div
        v-if="showEmojiPicker"
        class="absolute z-30 bottom-full mb-1 flex gap-0.5 p-1 rounded-lg border border-border bg-popover shadow-lg"
        :class="isMine ? 'right-0' : 'left-0'"
      >
        <button
          v-for="emoji in EMOJIS"
          :key="emoji"
          class="w-7 h-7 flex items-center justify-center rounded hover:bg-accent transition-colors text-sm"
          @click="handleReact(emoji)"
        >
          {{ emoji }}
        </button>
      </div>
    </div>

    <!-- Copy -->
    <button
      v-if="msg.text"
      class="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
      :title="copied ? 'Copied!' : 'Copy'"
      @click="copyText"
    >
      <Copy class="w-3 h-3" />
    </button>

    <!-- Forward -->
    <button
      class="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
      title="Forward"
      @click="$emit('forward', msg)"
    >
      <Forward class="w-3 h-3" />
    </button>

    <!-- Pin (groups only) -->
    <button
      v-if="showPin"
      class="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
      title="Pin message"
      @click="$emit('pin', msg)"
    >
      <Pin class="w-3 h-3" />
    </button>

    <!-- Edit (own messages only) -->
    <button
      v-if="isMine && msg.text && !msg.deleted"
      class="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
      title="Edit"
      @click="$emit('edit', msg)"
    >
      <Pencil class="w-3 h-3" />
    </button>

    <!-- Delete (own messages only) -->
    <button
      v-if="isMine && !msg.deleted"
      class="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
      title="Delete"
      @click="$emit('delete', msg)"
    >
      <Trash2 class="w-3 h-3" />
    </button>
  </div>
</template>
