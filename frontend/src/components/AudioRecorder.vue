<script setup lang="ts">
import { ref } from 'vue'
import { useAuth } from '@/composables/useAuth'
import { Mic, Square, Loader2 } from 'lucide-vue-next'

const emit = defineEmits(['recorded'])
const { token } = useAuth()

const isRecording = ref(false)
const uploading = ref(false)
const recordingDuration = ref(0)

let mediaRecorder = null
let audioChunks = []
let durationTimer = null

async function startRecording() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' })
    audioChunks = []
    recordingDuration.value = 0

    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) audioChunks.push(e.data)
    }

    mediaRecorder.onstop = async () => {
      stream.getTracks().forEach(t => t.stop())
      clearInterval(durationTimer)
      const blob = new Blob(audioChunks, { type: 'audio/webm' })
      if (blob.size < 1000) return
      await uploadAudio(blob)
    }

    mediaRecorder.start()
    isRecording.value = true
    durationTimer = setInterval(() => { recordingDuration.value++ }, 1000)
  } catch (err) {
    console.error('Microphone access denied:', err)
  }
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop()
  }
  isRecording.value = false
}

async function uploadAudio(blob) {
  uploading.value = true
  try {
    const file = new File([blob], `voice_${Date.now()}.webm`, { type: 'audio/webm' })
    const form = new FormData()
    form.append('file', file)
    const res = await fetch('/api/upload', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token.value}` },
      body: form,
    })
    const data = await res.json()
    if (res.ok) {
      emit('recorded', { url: data.url, name: data.name, type: data.type, size: data.size })
    }
  } catch (err) {
    console.error('Upload error:', err)
  } finally {
    uploading.value = false
  }
}

function formatDuration(sec) {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}:${String(s).padStart(2, '0')}`
}
</script>

<template>
  <div class="flex items-center gap-1">
    <template v-if="isRecording">
      <div class="flex items-center gap-2 px-2 py-1 rounded-lg bg-destructive/10 border border-destructive/20">
        <span class="w-2 h-2 rounded-full bg-destructive animate-pulse" />
        <span class="text-xs font-medium text-destructive">{{ formatDuration(recordingDuration) }}</span>
      </div>
      <button
        class="p-1.5 rounded-md bg-destructive text-white hover:bg-destructive/90 transition-colors"
        title="Stop recording"
        @click="stopRecording"
      >
        <Square class="w-3.5 h-3.5" />
      </button>
    </template>

    <template v-else-if="uploading">
      <Loader2 class="w-4 h-4 text-muted-foreground animate-spin" />
    </template>

    <button
      v-else
      class="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
      title="Record voice message"
      @click="startRecording"
    >
      <Mic class="w-4 h-4" />
    </button>
  </div>
</template>
