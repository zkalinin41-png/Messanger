<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue'
import { Room, RoomEvent, Track } from 'livekit-client'
import { useVideoCall, callState, callToken, callUrl, callPartner, callMode } from '@/composables/useVideoCall'
import { usernameColor } from '@/utils/color'
import { Mic, MicOff, Video, VideoOff, PhoneOff, Phone, MonitorUp, MonitorOff } from 'lucide-vue-next'

const { acceptCall, rejectCall, endCall } = useVideoCall()

const remoteVideoRef = ref(null)
const localVideoRef = ref(null)
const micOn = ref(true)
const camOn = ref(true)
const screenSharing = ref(false)
const duration = ref(0)

let room = null
let durationTimer = null

const partnerColor = () => usernameColor(callPartner.value ?? '')
const isAudioOnly = () => callMode.value === 'audio'

// ── LiveKit room ──────────────────────────────────────────────────────────────
async function connectRoom() {
  room = new Room()

  room.on(RoomEvent.TrackSubscribed, (track) => {
    if (track.kind === Track.Kind.Video) {
      const el = track.attach()
      el.style.cssText = 'width:100%;height:100%;object-fit:cover;'
      if (remoteVideoRef.value) {
        remoteVideoRef.value.innerHTML = ''
        remoteVideoRef.value.appendChild(el)
      }
    } else if (track.kind === Track.Kind.Audio) {
      const el = track.attach()
      document.body.appendChild(el)
    }
  })

  room.on(RoomEvent.TrackUnsubscribed, (track) => {
    track.detach()
  })

  await room.connect(callUrl.value, callToken.value)

  // Publish local tracks based on call mode
  if (isAudioOnly()) {
    await room.localParticipant.setMicrophoneEnabled(true)
    camOn.value = false
  } else {
    await room.localParticipant.enableCameraAndMicrophone()
    // Attach local camera preview
    const camPub = room.localParticipant.getTrackPublications().find(
      p => p.track?.kind === Track.Kind.Video
    )
    if (camPub?.track && localVideoRef.value) {
      const el = camPub.track.attach()
      el.style.cssText = 'width:100%;height:100%;object-fit:cover;'
      localVideoRef.value.innerHTML = ''
      localVideoRef.value.appendChild(el)
    }
  }

  durationTimer = setInterval(() => { duration.value++ }, 1000)
}

async function toggleMic() {
  if (!room) return
  micOn.value = !micOn.value
  await room.localParticipant.setMicrophoneEnabled(micOn.value)
}

async function toggleCam() {
  if (!room) return
  camOn.value = !camOn.value
  await room.localParticipant.setCameraEnabled(camOn.value)
  if (camOn.value) {
    // Re-attach local preview
    setTimeout(() => {
      const camPub = room.localParticipant.getTrackPublications().find(
        p => p.track?.kind === Track.Kind.Video && p.track?.source === Track.Source.Camera
      )
      if (camPub?.track && localVideoRef.value) {
        const el = camPub.track.attach()
        el.style.cssText = 'width:100%;height:100%;object-fit:cover;'
        localVideoRef.value.innerHTML = ''
        localVideoRef.value.appendChild(el)
      }
    }, 300)
  }
}

async function toggleScreenShare() {
  if (!room) return
  try {
    screenSharing.value = !screenSharing.value
    await room.localParticipant.setScreenShareEnabled(screenSharing.value)
  } catch (err) {
    screenSharing.value = false
    console.error('Screen share error:', err)
  }
}

function formatDuration(secs) {
  const m = Math.floor(secs / 60).toString().padStart(2, '0')
  const s = (secs % 60).toString().padStart(2, '0')
  return `${m}:${s}`
}

watch(callState, async (state) => {
  if (state === 'connected' && callToken.value) {
    await connectRoom()
  }
  if (state === 'idle') {
    cleanup()
  }
}, { immediate: true })

onUnmounted(cleanup)

function cleanup() {
  clearInterval(durationTimer)
  durationTimer = null
  duration.value = 0
  screenSharing.value = false
  camOn.value = true
  micOn.value = true
  if (room) {
    room.disconnect()
    room = null
  }
  document.querySelectorAll('audio[data-lk-audio]').forEach(el => el.remove())
}
</script>

<template>
  <div class="fixed inset-0 z-50 bg-zinc-950 flex flex-col select-none">

    <!-- ── Calling state ── -->
    <template v-if="callState === 'calling'">
      <div class="flex flex-col items-center justify-center flex-1 gap-6">
        <div
          class="w-20 h-20 rounded-full flex items-center justify-center text-white text-2xl font-bold ring-4 ring-white/20 animate-pulse"
          :style="{ backgroundColor: partnerColor() }"
        >
          {{ callPartner?.slice(0, 2).toUpperCase() }}
        </div>
        <div class="text-center">
          <p class="text-white text-xl font-semibold">{{ callPartner }}</p>
          <p class="text-zinc-400 text-sm mt-1">{{ callMode === 'audio' ? 'Audio call…' : 'Calling…' }}</p>
        </div>
        <button
          class="mt-4 w-14 h-14 rounded-full bg-red-500 hover:bg-red-600 flex items-center justify-center transition-colors"
          title="Cancel"
          @click="endCall"
        >
          <PhoneOff class="w-6 h-6 text-white" />
        </button>
      </div>
    </template>

    <!-- ── Incoming state ── -->
    <template v-else-if="callState === 'incoming'">
      <div class="flex flex-col items-center justify-center flex-1 gap-6">
        <div
          class="w-20 h-20 rounded-full flex items-center justify-center text-white text-2xl font-bold ring-4 ring-emerald-400/40"
          :style="{ backgroundColor: partnerColor() }"
        >
          {{ callPartner?.slice(0, 2).toUpperCase() }}
        </div>
        <div class="text-center">
          <p class="text-white text-xl font-semibold">{{ callPartner }}</p>
          <p class="text-zinc-400 text-sm mt-1">{{ callMode === 'audio' ? 'Incoming audio call…' : 'Incoming video call…' }}</p>
        </div>
        <div class="flex gap-8 mt-4">
          <button
            class="w-14 h-14 rounded-full bg-red-500 hover:bg-red-600 flex items-center justify-center transition-colors"
            title="Decline"
            @click="rejectCall"
          >
            <PhoneOff class="w-6 h-6 text-white" />
          </button>
          <button
            class="w-14 h-14 rounded-full bg-emerald-500 hover:bg-emerald-600 flex items-center justify-center transition-colors"
            title="Accept"
            @click="acceptCall"
          >
            <Phone class="w-6 h-6 text-white" />
          </button>
        </div>
      </div>
    </template>

    <!-- ── Connected state ── -->
    <template v-else-if="callState === 'connected'">
      <!-- Top bar -->
      <div class="flex items-center gap-3 px-5 py-3 bg-zinc-900/80">
        <div
          class="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
          :style="{ backgroundColor: partnerColor() }"
        >
          {{ callPartner?.slice(0, 2).toUpperCase() }}
        </div>
        <div>
          <p class="text-white text-sm font-semibold leading-tight">{{ callPartner }}</p>
          <p class="text-zinc-400 text-xs leading-tight">{{ formatDuration(duration) }}</p>
        </div>
      </div>

      <!-- Video / Audio area -->
      <div class="relative flex-1 bg-zinc-900 overflow-hidden">
        <!-- Remote video -->
        <div ref="remoteVideoRef" class="w-full h-full flex items-center justify-center">
          <div
            class="w-24 h-24 rounded-full flex items-center justify-center text-white text-3xl font-bold opacity-30"
            :style="{ backgroundColor: partnerColor() }"
          >
            {{ callPartner?.slice(0, 2).toUpperCase() }}
          </div>
        </div>

        <!-- Local video PiP -->
        <div
          v-if="camOn"
          ref="localVideoRef"
          class="absolute bottom-4 right-4 w-36 h-28 rounded-xl overflow-hidden border-2 border-zinc-700 bg-zinc-800"
        />
      </div>

      <!-- Controls -->
      <div class="flex items-center justify-center gap-4 py-5 bg-zinc-900/80">
        <button
          class="w-12 h-12 rounded-full flex items-center justify-center transition-colors"
          :class="micOn ? 'bg-zinc-700 hover:bg-zinc-600' : 'bg-red-500 hover:bg-red-600'"
          :title="micOn ? 'Mute mic' : 'Unmute mic'"
          @click="toggleMic"
        >
          <Mic v-if="micOn" class="w-5 h-5 text-white" />
          <MicOff v-else class="w-5 h-5 text-white" />
        </button>

        <button
          class="w-12 h-12 rounded-full flex items-center justify-center transition-colors"
          :class="camOn ? 'bg-zinc-700 hover:bg-zinc-600' : 'bg-red-500 hover:bg-red-600'"
          :title="camOn ? 'Turn off camera' : 'Turn on camera'"
          @click="toggleCam"
        >
          <Video v-if="camOn" class="w-5 h-5 text-white" />
          <VideoOff v-else class="w-5 h-5 text-white" />
        </button>

        <!-- Screen share -->
        <button
          class="w-12 h-12 rounded-full flex items-center justify-center transition-colors"
          :class="screenSharing ? 'bg-violet-600 hover:bg-violet-700' : 'bg-zinc-700 hover:bg-zinc-600'"
          :title="screenSharing ? 'Stop sharing screen' : 'Share screen'"
          @click="toggleScreenShare"
        >
          <MonitorOff v-if="screenSharing" class="w-5 h-5 text-white" />
          <MonitorUp v-else class="w-5 h-5 text-white" />
        </button>

        <button
          class="w-14 h-14 rounded-full bg-red-500 hover:bg-red-600 flex items-center justify-center transition-colors"
          title="End call"
          @click="endCall"
        >
          <PhoneOff class="w-6 h-6 text-white" />
        </button>
      </div>
    </template>

  </div>
</template>
