<script setup lang="ts">
import { ref } from 'vue'
import { useGroups } from '@/composables/useGroups'
import Button from '@/components/ui/button/Button.vue'
import Input from '@/components/ui/input/Input.vue'
import { X } from 'lucide-vue-next'

const emit = defineEmits(['close', 'created'])

const { createGroup } = useGroups()

const name = ref('')
const description = ref('')
const error = ref('')
const loading = ref(false)

async function handleCreate() {
  error.value = ''
  if (!name.value.trim()) { error.value = 'Group name is required'; return }
  loading.value = true
  try {
    const group = await createGroup(name.value.trim(), description.value.trim())
    emit('created', group)
    emit('close')
  } catch (err) {
    error.value = err.message
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <!-- Backdrop -->
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
    @click.self="$emit('close')"
  >
    <div class="bg-background rounded-2xl shadow-2xl w-full max-w-sm mx-4 p-6">

      <div class="flex items-center justify-between mb-5">
        <h2 class="font-semibold text-base">Create group</h2>
        <button class="p-1 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors" @click="$emit('close')">
          <X class="w-4 h-4" />
        </button>
      </div>

      <div class="space-y-3">
        <div>
          <label class="text-xs font-medium text-muted-foreground block mb-1">Name</label>
          <Input
            v-model="name"
            placeholder="e.g. Project Alpha"
            maxlength="64"
            :disabled="loading"
            @keydown.enter="handleCreate"
          />
        </div>
        <div>
          <label class="text-xs font-medium text-muted-foreground block mb-1">Description <span class="opacity-50">(optional)</span></label>
          <Input
            v-model="description"
            placeholder="What's this group about?"
            :disabled="loading"
            @keydown.enter="handleCreate"
          />
        </div>
        <p v-if="error" class="text-xs text-destructive">{{ error }}</p>
      </div>

      <div class="flex gap-2 mt-5">
        <Button variant="outline" class="flex-1" :disabled="loading" @click="$emit('close')">Cancel</Button>
        <Button class="flex-1" :disabled="loading || !name.trim()" @click="handleCreate">
          {{ loading ? 'Creating…' : 'Create' }}
        </Button>
      </div>

    </div>
  </div>
</template>
