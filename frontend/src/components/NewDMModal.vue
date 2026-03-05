<script setup lang="ts">
import { ref, watch } from 'vue'
import { useDMs } from '@/composables/useDMs'
import Input from '@/components/ui/input/Input.vue'
import { X, Search } from 'lucide-vue-next'

const emit = defineEmits(['open-dm', 'close'])

const { searchUsers } = useDMs()

const query = ref('')
const results = ref([])
const loading = ref(false)

let searchTimer = null

watch(query, (q) => {
  clearTimeout(searchTimer)
  if (!q.trim()) { results.value = []; return }
  loading.value = true
  searchTimer = setTimeout(async () => {
    results.value = await searchUsers(q)
    loading.value = false
  }, 300)
})

function select(user) {
  emit('open-dm', user.username)
  emit('close')
}
</script>

<template>
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
    @click.self="$emit('close')"
  >
    <div class="bg-background rounded-2xl shadow-2xl w-full max-w-sm mx-4 p-6">

      <div class="flex items-center justify-between mb-4">
        <h2 class="font-semibold text-base">New Direct Message</h2>
        <button class="p-1 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors" @click="$emit('close')">
          <X class="w-4 h-4" />
        </button>
      </div>

      <div class="relative">
        <Search class="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
        <Input
          v-model="query"
          placeholder="Search users…"
          class="pl-8"
          autofocus
        />
      </div>

      <div class="mt-3 space-y-0.5 max-h-60 overflow-y-auto">
        <div v-if="loading" class="py-6 text-center text-sm text-muted-foreground">Searching…</div>
        <div v-else-if="query.trim() && results.length === 0" class="py-6 text-center text-sm text-muted-foreground">No users found</div>

        <button
          v-for="user in results"
          :key="user.username"
          class="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-accent transition-colors text-left"
          @click="select(user)"
        >
          <div class="relative flex-shrink-0">
            <div
              class="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold"
              :style="{ backgroundColor: user.color }"
            >
              {{ user.username.slice(0, 2).toUpperCase() }}
            </div>
            <div
              class="absolute -bottom-px -right-px w-2.5 h-2.5 rounded-full border-2 border-background"
              :class="user.online ? 'bg-emerald-500' : 'bg-muted-foreground/40'"
            />
          </div>
          <div class="min-w-0">
            <p class="text-sm font-medium truncate">{{ user.username }}</p>
            <p class="text-xs text-muted-foreground">{{ user.online ? 'Online' : 'Offline' }}</p>
          </div>
        </button>
      </div>

    </div>
  </div>
</template>
