<script setup>
import { ref, watch } from 'vue'
import { useAuth } from '@/composables/useAuth'
import { usernameColor } from '@/utils/color'
import { Search, X, MessageCircle, Users, Hash } from 'lucide-vue-next'

const emit = defineEmits(['close', 'open-dm', 'open-group'])

const { token } = useAuth()
const query = ref('')
const results = ref([])
const loading = ref(false)
const inputRef = ref(null)

let debounceTimer = null

watch(query, (q) => {
  clearTimeout(debounceTimer)
  if (!q.trim() || q.trim().length < 2) { results.value = []; return }
  loading.value = true
  debounceTimer = setTimeout(async () => {
    try {
      const res = await fetch(`/api/search/messages?q=${encodeURIComponent(q.trim())}`, {
        headers: { Authorization: `Bearer ${token.value}` },
      })
      const data = await res.json()
      results.value = data.results || []
    } catch { results.value = [] }
    loading.value = false
  }, 300)
})

function formatTime(ts) {
  const d = new Date(ts)
  const now = new Date()
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

function handleSelect(result) {
  if (result.source_type === 'dm') {
    emit('open-dm', result.partner)
  } else if (result.source_type === 'group') {
    emit('open-group', result.group_id)
  }
  emit('close')
}

function highlightMatch(text, q) {
  if (!q || !text) return text
  const esc = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return text.replace(new RegExp(`(${esc})`, 'gi'), '<mark class="bg-yellow-500/30 text-foreground rounded px-0.5">$1</mark>')
}
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-start justify-center pt-[10vh]" @click.self="$emit('close')">
    <div class="w-full max-w-lg bg-popover border border-border rounded-xl shadow-2xl overflow-hidden">
      <!-- Search input -->
      <div class="flex items-center gap-2 px-4 py-3 border-b border-border">
        <Search class="w-4 h-4 text-muted-foreground flex-shrink-0" />
        <input
          ref="inputRef"
          v-model="query"
          type="text"
          placeholder="Search messages…"
          class="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          autofocus
        />
        <button
          v-if="query"
          class="p-0.5 rounded hover:bg-accent text-muted-foreground"
          @click="query = ''"
        >
          <X class="w-3.5 h-3.5" />
        </button>
      </div>

      <!-- Results -->
      <div class="max-h-[50vh] overflow-y-auto">
        <div v-if="loading" class="flex items-center justify-center py-8 text-muted-foreground">
          <div class="w-4 h-4 rounded-full border-2 border-muted-foreground border-t-transparent animate-spin" />
        </div>

        <div v-else-if="query.trim().length >= 2 && results.length === 0" class="py-8 text-center text-sm text-muted-foreground">
          No results found
        </div>

        <div v-else-if="results.length > 0" class="py-1">
          <button
            v-for="r in results"
            :key="`${r.source_type}-${r.id}`"
            class="w-full px-4 py-2.5 flex items-start gap-3 hover:bg-accent/60 transition-colors text-left"
            @click="handleSelect(r)"
          >
            <!-- Icon -->
            <div class="flex-shrink-0 mt-0.5">
              <div v-if="r.source_type === 'dm'"
                class="w-6 h-6 rounded-full flex items-center justify-center text-white text-[9px] font-bold"
                :style="{ backgroundColor: usernameColor(r.partner) }"
              >
                {{ r.partner.slice(0, 2).toUpperCase() }}
              </div>
              <div v-else class="w-6 h-6 rounded-full bg-muted flex items-center justify-center">
                <Hash class="w-3 h-3 text-muted-foreground" />
              </div>
            </div>
            <!-- Content -->
            <div class="flex-1 min-w-0">
              <div class="flex items-baseline gap-2">
                <span class="text-xs font-semibold" :style="{ color: r.color }">{{ r.from_user }}</span>
                <span class="text-[10px] text-muted-foreground">
                  {{ r.source_type === 'dm' ? `DM with ${r.partner}` : `#${r.group_name}` }}
                </span>
                <span class="ml-auto text-[10px] text-muted-foreground flex-shrink-0">{{ formatTime(r.timestamp) }}</span>
              </div>
              <p class="text-xs text-muted-foreground truncate mt-0.5" v-html="highlightMatch(r.text, query.trim())" />
            </div>
          </button>
        </div>

        <div v-else class="py-8 text-center text-sm text-muted-foreground opacity-60">
          Type at least 2 characters to search
        </div>
      </div>
    </div>
  </div>
</template>
