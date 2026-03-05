import { ref, type Ref } from 'vue'
import { useAuth } from './useAuth'

// ── Module-level shared state ─────────────────────────────────────────────────
export const callState: Ref<'idle' | 'calling' | 'incoming' | 'connected'> = ref('idle')
export const callPartner: Ref<string | null> = ref(null)
export const callToken: Ref<string | null> = ref(null)
export const callUrl: Ref<string | null> = ref(null)
export const callMode: Ref<'video' | 'audio'> = ref('video')

// Injected by useWebSocket once the connection is ready (avoids circular import)
let _sendWs: ((payload: Record<string, unknown>) => void) | null = null
export function setWsSender(fn: (payload: Record<string, unknown>) => void): void { _sendWs = fn }

function send(payload: Record<string, unknown>): void {
    if (_sendWs) _sendWs(payload)
}

async function fetchVideoToken(partner: string): Promise<{ token: string; url: string; room: string }> {
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
    async function startCall(partner: string, mode: 'video' | 'audio' = 'video'): Promise<void> {
        callState.value = 'calling'
        callPartner.value = partner
        callMode.value = mode
        send({ type: 'call_invite', toUser: partner, callMode: mode })
    }

    async function acceptCall(): Promise<void> {
        try {
            const data = await fetchVideoToken(callPartner.value!)
            callToken.value = data.token
            callUrl.value = data.url
            callState.value = 'connected'
            send({ type: 'call_accept', toUser: callPartner.value })
        } catch (err) {
            console.error('Video token error:', err)
            resetCall()
        }
    }

    function rejectCall(): void {
        send({ type: 'call_reject', toUser: callPartner.value })
        resetCall()
    }

    function endCall(): void {
        send({ type: 'call_end', toUser: callPartner.value })
        resetCall()
    }

    function resetCall(): void {
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
