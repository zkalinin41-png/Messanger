<script setup>
import { ref } from 'vue'
import { Smile } from 'lucide-vue-next'

const emit = defineEmits(['select'])
const showPicker = ref(false)

const EMOJI_GROUPS = {
  'Smileys': ['😀', '😃', '😄', '😁', '😅', '😂', '🤣', '😊', '😇', '🙂', '😉', '😍', '🥰', '😘', '😋', '😜', '🤪', '🤔', '🤗', '🤫', '🤐', '😐', '😑', '😶', '😏', '😒', '🙄', '😬', '😮‍💨', '😌', '😔', '😴', '🤯', '😳', '🥺', '😢', '😭', '😤', '😡', '🤬'],
  'Gestures': ['👋', '🤚', '✋', '🖖', '👌', '🤌', '🤏', '✌️', '🤞', '🤟', '🤘', '🤙', '👈', '👉', '👆', '👇', '☝️', '👍', '👎', '👏', '🙌', '🤝', '🙏', '✍️', '💪'],
  'Hearts': ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '💔', '❤️‍🔥', '💕', '💞', '💓', '💗', '💖', '💝'],
  'Objects': ['🔥', '⭐', '🌟', '✨', '💫', '🎉', '🎊', '🎁', '🏆', '🎯', '💡', '📌', '📎', '✅', '❌', '‼️', '❓', '❗', '💯', '🔔', '🎵', '🎶'],
}

function selectEmoji(emoji) {
  emit('select', emoji)
  showPicker.value = false
}
</script>

<template>
  <div class="relative">
    <button
      class="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors flex-shrink-0 mb-0.5"
      title="Emoji"
      @click="showPicker = !showPicker"
    >
      <Smile class="w-4 h-4" />
    </button>

    <!-- Emoji picker panel -->
    <div
      v-if="showPicker"
      class="absolute bottom-full mb-2 left-0 w-72 max-h-60 overflow-y-auto rounded-xl border border-border bg-popover shadow-xl p-2 z-40"
    >
      <div v-for="(emojis, groupName) in EMOJI_GROUPS" :key="groupName" class="mb-2">
        <p class="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1 px-1">{{ groupName }}</p>
        <div class="flex flex-wrap gap-0.5">
          <button
            v-for="emoji in emojis"
            :key="emoji"
            class="w-8 h-8 flex items-center justify-center rounded hover:bg-accent transition-colors text-lg"
            @click="selectEmoji(emoji)"
          >
            {{ emoji }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
