import { ref } from 'vue'
import { useAuth } from './useAuth'

// ── Module-level shared state ─────────────────────────────────────────────────
export const callState = ref('idle')    // 'idle' | 'calling' | 'incoming' | 'connected'
export const callPartner = ref(null)    // username of the other person
export const callToken = ref(null)      // LiveKit JWT
export const callUrl = ref(null)        // LiveKit WSS URL
export const callMode = ref('video')    // 'video' | 'audio'

// Injected by useWebSocket once the connection is ready (avoids circular import)
let _sendWs = null
export function setWsSender(fn) { _sendWs = fn }

function send(payload) {
  if (_sendWs) _sendWs(payload)
}

async function fetchVideoToken(partner) {
  const { token } = useAuth()
  const res = await fetch('/api/video/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token.value}` },
    body: JSON.stringify({ partner }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Token fetch failed')
  return data
}

export function useVideoCall() {
  async function startCall(partner, mode = 'video') {
    callState.value = 'calling'
    callPartner.value = partner
    callMode.value = mode
    send({ type: 'call_invite', toUser: partner, callMode: mode })
  }

  async function acceptCall() {
    try {
      const data = await fetchVideoToken(callPartner.value)
      callToken.value = data.token
      callUrl.value = data.url
      callState.value = 'connected'
      send({ type: 'call_accept', toUser: callPartner.value })
    } catch (err) {
      console.error('Video token error:', err)
      resetCall()
    }
  }

  function rejectCall() {
    send({ type: 'call_reject', toUser: callPartner.value })
    resetCall()
  }

  function endCall() {
    send({ type: 'call_end', toUser: callPartner.value })
    resetCall()
  }

  function resetCall() {
    callState.value = 'idle'
    callPartner.value = null
    callToken.value = null
    callUrl.value = null
    callMode.value = 'video'
  }

  return { callState, callPartner, callToken, callUrl, callMode, startCall, acceptCall, rejectCall, endCall }
}

// Used by useWebSocket to handle incoming call signals
export { fetchVideoToken }
