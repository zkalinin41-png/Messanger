<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { useAuth } from '@/composables/useAuth'
import Card from '@/components/ui/card/Card.vue'
import CardHeader from '@/components/ui/card/CardHeader.vue'
import CardTitle from '@/components/ui/card/CardTitle.vue'
import CardDescription from '@/components/ui/card/CardDescription.vue'
import CardContent from '@/components/ui/card/CardContent.vue'
import CardFooter from '@/components/ui/card/CardFooter.vue'
import Button from '@/components/ui/button/Button.vue'
import Input from '@/components/ui/input/Input.vue'
import { MessageCircle, ArrowLeft, MailCheck } from 'lucide-vue-next'

const emit = defineEmits(['authenticated'])
const { login, register } = useAuth()

// mode: 'login' | 'register' | 'pending-verification' | 'forgot-password' | 'reset-password'
const mode = ref('login')

const username = ref('')
const email = ref('')
const password = ref('')
const confirmPassword = ref('')
const resetToken = ref('')
const pendingEmail = ref('')   // email waiting for verification
const error = ref('')
const info = ref('')           // success/info banners
const loading = ref(false)

// Username availability check (register form)
const usernameAvailable = ref(null) // null | true | false
const checkingUsername = ref(false)
let usernameCheckTimer = null

watch(username, (val) => {
  usernameAvailable.value = null
  clearTimeout(usernameCheckTimer)
  if (mode.value !== 'register' || val.trim().length < 2) return
  checkingUsername.value = true
  usernameCheckTimer = setTimeout(async () => {
    try {
      const res = await fetch(`/api/check-username?u=${encodeURIComponent(val.trim())}`)
      const data = await res.json()
      usernameAvailable.value = data.available
    } catch {
      usernameAvailable.value = null
    } finally {
      checkingUsername.value = false
    }
  }, 400)
})

// On mount: handle ?verified=1 and ?reset_token=xxx from email links
onMounted(() => {
  const params = new URLSearchParams(window.location.search)

  if (params.get('verified') === '1') {
    info.value = 'Email verified! You can now sign in.'
    window.history.replaceState({}, '', window.location.pathname)
  }

  const rt = params.get('reset_token')
  if (rt) {
    resetToken.value = rt
    mode.value = 'reset-password'
    window.history.replaceState({}, '', window.location.pathname)
  }
})

function clearForm() {
  username.value = ''
  email.value = ''
  password.value = ''
  confirmPassword.value = ''
  error.value = ''
  info.value = ''
  usernameAvailable.value = null
}

function switchMode(next) {
  clearForm()
  mode.value = next
}

// --- Register ---
async function handleRegister() {
  error.value = ''
  if (!username.value.trim() || !email.value.trim() || !password.value) {
    error.value = 'All fields are required'
    return
  }
  loading.value = true
  try {
    const res = await register(username.value.trim(), email.value.trim(), password.value)
    if (res.token) {
      // Auto-login: save session and emit authenticated
      localStorage.setItem('auth_token', res.token)
      localStorage.setItem('auth_username', res.username!)
      window.location.reload()
    } else {
      pendingEmail.value = res.email
      clearForm()
      mode.value = 'pending-verification'
    }
  } catch (err) {
    error.value = err.message
  } finally {
    loading.value = false
  }
}

// --- Login ---
async function handleLogin() {
  error.value = ''
  if (!username.value.trim() || !password.value) {
    error.value = 'Please fill in all fields'
    return
  }
  loading.value = true
  try {
    await login(username.value.trim(), password.value)
    window.location.reload()
  } catch (err) {
    if (err.needsVerification) {
      pendingEmail.value = err.email || ''
      clearForm()
      mode.value = 'pending-verification'
    } else {
      error.value = err.message
    }
  } finally {
    loading.value = false
  }
}

// --- Resend verification ---
async function handleResend() {
  error.value = ''
  info.value = ''
  loading.value = true
  try {
    const res = await fetch('/api/resend-verification', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: pendingEmail.value }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error)
    info.value = 'Verification email resent — check your inbox.'
  } catch (err) {
    error.value = err.message
  } finally {
    loading.value = false
  }
}

// --- Forgot password ---
async function handleForgotPassword() {
  error.value = ''
  if (!email.value.trim()) {
    error.value = 'Please enter your email'
    return
  }
  loading.value = true
  try {
    const res = await fetch('/api/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email.value.trim() }),
    })
    const data = await res.json()
    info.value = data.message
    email.value = ''
  } catch {
    error.value = 'Something went wrong. Please try again.'
  } finally {
    loading.value = false
  }
}

// --- Reset password ---
async function handleResetPassword() {
  error.value = ''
  if (!password.value || !confirmPassword.value) {
    error.value = 'Please fill in both fields'
    return
  }
  if (password.value !== confirmPassword.value) {
    error.value = 'Passwords do not match'
    return
  }
  loading.value = true
  try {
    const res = await fetch('/api/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: resetToken.value, newPassword: password.value }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error)
    clearForm()
    mode.value = 'login'
    info.value = data.message
  } catch (err) {
    error.value = err.message
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <Card class="w-full max-w-sm shadow-xl">

    <!-- Icon header -->
    <CardHeader class="text-center pb-2">
      <div class="flex justify-center mb-4">
        <div class="w-16 h-16 rounded-2xl bg-primary flex items-center justify-center shadow-lg">
          <MailCheck v-if="mode === 'pending-verification'" class="w-8 h-8 text-primary-foreground" />
          <MessageCircle v-else class="w-8 h-8 text-primary-foreground" />
        </div>
      </div>

      <!-- Login -->
      <template v-if="mode === 'login'">
        <CardTitle>Welcome back</CardTitle>
        <CardDescription>Sign in to join the chat</CardDescription>
      </template>
      <!-- Register -->
      <template v-else-if="mode === 'register'">
        <CardTitle>Create account</CardTitle>
        <CardDescription>Sign up to get started</CardDescription>
      </template>
      <!-- Pending verification -->
      <template v-else-if="mode === 'pending-verification'">
        <CardTitle>Check your inbox</CardTitle>
        <CardDescription>
          We sent a verification link to<br>
          <span class="font-medium text-foreground">{{ pendingEmail }}</span>
        </CardDescription>
      </template>
      <!-- Forgot password -->
      <template v-else-if="mode === 'forgot-password'">
        <CardTitle>Forgot password?</CardTitle>
        <CardDescription>Enter your email to receive a reset link</CardDescription>
      </template>
      <!-- Reset password -->
      <template v-else-if="mode === 'reset-password'">
        <CardTitle>Set new password</CardTitle>
        <CardDescription>Choose a new password for your account</CardDescription>
      </template>
    </CardHeader>

    <!-- ── Login form ── -->
    <template v-if="mode === 'login'">
      <CardContent class="space-y-3">
        <p v-if="info" class="text-xs text-emerald-600 bg-emerald-50 rounded-md px-3 py-2">{{ info }}</p>
        <Input v-model="username" placeholder="Username or email" autocomplete="username"
               :disabled="loading" @keydown.enter="handleLogin" />
        <Input v-model="password" type="password" placeholder="Password" autocomplete="current-password"
               :disabled="loading" @keydown.enter="handleLogin" />
        <p v-if="error" class="text-xs text-destructive">{{ error }}</p>
      </CardContent>
      <CardFooter class="flex flex-col gap-3">
        <Button class="w-full" :disabled="loading" @click="handleLogin">
          {{ loading ? 'Signing in…' : 'Sign In' }}
        </Button>
        <button class="text-xs text-muted-foreground hover:text-foreground transition-colors"
                @click="switchMode('forgot-password')">
          Forgot password?
        </button>
        <p class="text-xs text-center text-muted-foreground">
          Don't have an account?
          <button class="underline underline-offset-2 hover:text-foreground transition-colors"
                  @click="switchMode('register')">Sign up</button>
        </p>
      </CardFooter>
    </template>

    <!-- ── Register form ── -->
    <template v-else-if="mode === 'register'">
      <CardContent class="space-y-3">
        <div class="relative">
          <Input v-model="username" placeholder="Username" maxlength="24" autocomplete="username"
                 :disabled="loading" @keydown.enter="handleRegister" />
          <span v-if="checkingUsername" class="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">…</span>
          <span v-else-if="usernameAvailable === true" class="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-emerald-600">✓ Available</span>
          <span v-else-if="usernameAvailable === false" class="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-destructive">✗ Taken</span>
        </div>
        <Input v-model="email" type="email" placeholder="Email address" autocomplete="email"
               :disabled="loading" @keydown.enter="handleRegister" />
        <Input v-model="password" type="password" placeholder="Password (min 6 chars)" autocomplete="new-password"
               :disabled="loading" @keydown.enter="handleRegister" />
        <p v-if="error" class="text-xs text-destructive">{{ error }}</p>
      </CardContent>
      <CardFooter class="flex flex-col gap-3">
        <Button class="w-full" :disabled="loading" @click="handleRegister">
          {{ loading ? 'Creating account…' : 'Create Account' }}
        </Button>
        <p class="text-xs text-center text-muted-foreground">
          Already have an account?
          <button class="underline underline-offset-2 hover:text-foreground transition-colors"
                  @click="switchMode('login')">Sign in</button>
        </p>
      </CardFooter>
    </template>

    <!-- ── Pending verification ── -->
    <template v-else-if="mode === 'pending-verification'">
      <CardContent class="space-y-3 text-sm text-muted-foreground text-center">
        <p>Click the link in the email to activate your account.</p>
        <p v-if="info" class="text-xs text-emerald-600 bg-emerald-50 rounded-md px-3 py-2">{{ info }}</p>
        <p v-if="error" class="text-xs text-destructive">{{ error }}</p>
      </CardContent>
      <CardFooter class="flex flex-col gap-3">
        <Button variant="outline" class="w-full" :disabled="loading" @click="handleResend">
          {{ loading ? 'Sending…' : 'Resend verification email' }}
        </Button>
        <button class="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 mx-auto transition-colors"
                @click="switchMode('login')">
          <ArrowLeft class="w-3 h-3" /> Back to sign in
        </button>
      </CardFooter>
    </template>

    <!-- ── Forgot password ── -->
    <template v-else-if="mode === 'forgot-password'">
      <CardContent class="space-y-3">
        <p v-if="info" class="text-xs text-emerald-600 bg-emerald-50 rounded-md px-3 py-2">{{ info }}</p>
        <Input v-if="!info" v-model="email" type="email" placeholder="your@email.com"
               autocomplete="email" :disabled="loading" @keydown.enter="handleForgotPassword" />
        <p v-if="error" class="text-xs text-destructive">{{ error }}</p>
      </CardContent>
      <CardFooter class="flex flex-col gap-3">
        <Button v-if="!info" class="w-full" :disabled="loading" @click="handleForgotPassword">
          {{ loading ? 'Sending…' : 'Send reset link' }}
        </Button>
        <button class="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 mx-auto transition-colors"
                @click="switchMode('login')">
          <ArrowLeft class="w-3 h-3" /> Back to sign in
        </button>
      </CardFooter>
    </template>

    <!-- ── Reset password ── -->
    <template v-else-if="mode === 'reset-password'">
      <CardContent class="space-y-3">
        <Input v-model="password" type="password" placeholder="New password (min 6 chars)"
               autocomplete="new-password" :disabled="loading" @keydown.enter="handleResetPassword" />
        <Input v-model="confirmPassword" type="password" placeholder="Confirm new password"
               autocomplete="new-password" :disabled="loading" @keydown.enter="handleResetPassword" />
        <p v-if="error" class="text-xs text-destructive">{{ error }}</p>
      </CardContent>
      <CardFooter>
        <Button class="w-full" :disabled="loading" @click="handleResetPassword">
          {{ loading ? 'Saving…' : 'Set New Password' }}
        </Button>
      </CardFooter>
    </template>

  </Card>
</template>
