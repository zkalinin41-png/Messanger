import { ref, computed, type Ref, type ComputedRef } from 'vue'

const token: Ref<string | null> = ref(localStorage.getItem('auth_token'))
const username: Ref<string | null> = ref(localStorage.getItem('auth_username'))

interface LoginError extends Error {
    needsVerification?: boolean
    email?: string
}

export function useAuth() {
    const isAuthenticated: ComputedRef<boolean> = computed(() => !!token.value)

    async function register(usernameVal: string, emailVal: string, password: string): Promise<{ message: string; email: string; token?: string; username?: string }> {
        const res = await fetch('/api/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: usernameVal, email: emailVal, password }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error)
        return data
    }

    async function login(usernameVal: string, password: string): Promise<{ token: string; username: string }> {
        const res = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: usernameVal, password }),
        })
        const data = await res.json()
        if (!res.ok) {
            const err: LoginError = new Error(data.error)
            err.needsVerification = data.needsVerification || false
            err.email = data.email || ''
            throw err
        }
        _setSession(data.token, data.username)
        return data
    }

    function logout(): void {
        token.value = null
        username.value = null
        localStorage.removeItem('auth_token')
        localStorage.removeItem('auth_username')
    }

    function _setSession(t: string, u: string): void {
        token.value = t
        username.value = u
        localStorage.setItem('auth_token', t)
        localStorage.setItem('auth_username', u)
    }

    return { token, username, isAuthenticated, register, login, logout }
}
