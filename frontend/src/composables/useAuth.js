import { ref, computed } from 'vue'

const token = ref(localStorage.getItem('auth_token'))
const username = ref(localStorage.getItem('auth_username'))

export function useAuth() {
  const isAuthenticated = computed(() => !!token.value)

  async function register(usernameVal, emailVal, password) {
    const res = await fetch('/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: usernameVal, email: emailVal, password }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error)
    // Registration succeeds but returns no token — user must verify email first
    return data
  }

  async function login(usernameVal, password) {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: usernameVal, password }),
    })
    const data = await res.json()
    if (!res.ok) {
      const err = new Error(data.error)
      err.needsVerification = data.needsVerification || false
      err.email = data.email || ''
      throw err
    }
    _setSession(data.token, data.username)
    return data
  }

  function logout() {
    token.value = null
    username.value = null
    localStorage.removeItem('auth_token')
    localStorage.removeItem('auth_username')
  }

  function _setSession(t, u) {
    token.value = t
    username.value = u
    localStorage.setItem('auth_token', t)
    localStorage.setItem('auth_username', u)
  }

  return { token, username, isAuthenticated, register, login, logout }
}
