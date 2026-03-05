<script setup>
import { ref } from 'vue'
import { useAuth } from '@/composables/useAuth'
import { useTheme } from '@/composables/useTheme'
import { usernameColor } from '@/utils/color'
import Button from '@/components/ui/button/Button.vue'
import Input from '@/components/ui/input/Input.vue'
import { ArrowLeft, Sun, Moon, User, Lock, Camera } from 'lucide-vue-next'

defineEmits(['close'])

const { token, username } = useAuth()
const { isDark, toggleTheme } = useTheme()

const currentPassword = ref('')
const newPassword = ref('')
const confirmPassword = ref('')
const passwordError = ref('')
const passwordSuccess = ref('')
const loading = ref(false)

const avatarUrl = ref(null)
const avatarLoading = ref(false)
const avatarFileRef = ref(null)

// Load current avatar
async function loadAvatar() {
  try {
    const res = await fetch(`/api/users/${username.value}`, {
      headers: { Authorization: `Bearer ${token.value}` },
    })
    const data = await res.json()
    if (data.user?.avatar_url) avatarUrl.value = data.user.avatar_url
  } catch { /* ignore */ }
}
loadAvatar()

async function handleAvatarUpload(e) {
  const file = e.target.files?.[0]
  if (!file) return
  avatarLoading.value = true
  try {
    const form = new FormData()
    form.append('avatar', file)
    const res = await fetch('/api/avatar', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token.value}` },
      body: form,
    })
    const data = await res.json()
    if (res.ok) avatarUrl.value = data.avatar_url
  } catch (err) {
    console.error('Avatar upload error:', err)
  } finally {
    avatarLoading.value = false
    if (avatarFileRef.value) avatarFileRef.value.value = ''
  }
}

async function handleChangePassword() {
  passwordError.value = ''
  passwordSuccess.value = ''
  if (!currentPassword.value || !newPassword.value || !confirmPassword.value) {
    passwordError.value = 'All fields are required'
    return
  }
  if (newPassword.value !== confirmPassword.value) {
    passwordError.value = 'New passwords do not match'
    return
  }
  if (newPassword.value.length < 6) {
    passwordError.value = 'New password must be at least 6 characters'
    return
  }
  loading.value = true
  try {
    const res = await fetch('/api/change-password', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token.value}`,
      },
      body: JSON.stringify({ currentPassword: currentPassword.value, newPassword: newPassword.value }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error)
    passwordSuccess.value = data.message
    currentPassword.value = ''
    newPassword.value = ''
    confirmPassword.value = ''
  } catch (err) {
    passwordError.value = err.message
  } finally {
    loading.value = false
  }
}

const userColor = usernameColor(username.value ?? '')
</script>

<template>
  <div class="flex flex-col h-full">
    <!-- Header -->
    <div class="h-12 px-4 flex items-center gap-3 border-b border-border flex-shrink-0">
      <button
        class="p-1 rounded-md hover:bg-accent transition-colors text-muted-foreground hover:text-foreground"
        @click="$emit('close')"
      >
        <ArrowLeft class="w-4 h-4" />
      </button>
      <span class="font-semibold text-sm">Settings</span>
    </div>

    <div class="flex-1 overflow-y-auto">
      <div class="max-w-md p-6 space-y-8">

        <!-- Profile / Avatar -->
        <section>
          <h3 class="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest mb-3">Profile</h3>
          <div class="p-4 rounded-lg border border-border bg-card">
            <div class="flex items-center gap-4">
              <!-- Avatar -->
              <div class="relative group cursor-pointer" @click="avatarFileRef?.click()">
                <div
                  v-if="avatarUrl"
                  class="w-14 h-14 rounded-full overflow-hidden border-2 border-border"
                >
                  <img :src="avatarUrl" class="w-full h-full object-cover" />
                </div>
                <div
                  v-else
                  class="w-14 h-14 rounded-full flex items-center justify-center text-white text-lg font-bold border-2 border-border"
                  :style="{ backgroundColor: userColor }"
                >
                  {{ username?.slice(0, 2).toUpperCase() }}
                </div>
                <div class="absolute inset-0 rounded-full bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                  <Camera v-if="!avatarLoading" class="w-5 h-5 text-white" />
                  <div v-else class="w-4 h-4 rounded-full border-2 border-white border-t-transparent animate-spin" />
                </div>
              </div>
              <input ref="avatarFileRef" type="file" accept="image/*" class="hidden" @change="handleAvatarUpload" />
              <div>
                <div class="text-sm font-semibold">{{ username }}</div>
                <div class="text-xs text-muted-foreground">Click avatar to change</div>
              </div>
            </div>
          </div>
        </section>

        <!-- Appearance -->
        <section>
          <h3 class="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest mb-3">Appearance</h3>
          <div class="flex items-center justify-between p-4 rounded-lg border border-border bg-card">
            <div class="flex items-center gap-3">
              <div class="w-8 h-8 rounded-lg bg-muted flex items-center justify-center">
                <Moon v-if="isDark" class="w-4 h-4" />
                <Sun v-else class="w-4 h-4" />
              </div>
              <div>
                <div class="text-sm font-medium">{{ isDark ? 'Dark mode' : 'Light mode' }}</div>
                <div class="text-xs text-muted-foreground">Switch appearance theme</div>
              </div>
            </div>
            <!-- Toggle switch -->
            <button
              class="relative w-10 h-5 rounded-full transition-colors duration-200 focus:outline-none"
              :class="isDark ? 'bg-violet-600' : 'bg-slate-300 dark:bg-slate-600'"
              @click="toggleTheme"
            >
              <span
                class="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform duration-200"
                :class="isDark ? 'translate-x-5' : 'translate-x-0'"
              />
            </button>
          </div>
        </section>

        <!-- Account -->
        <section>
          <h3 class="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest mb-3">Account</h3>
          <div class="p-4 rounded-lg border border-border bg-card">
            <div class="flex items-center gap-3">
              <div class="w-8 h-8 rounded-lg bg-muted flex items-center justify-center">
                <User class="w-4 h-4 text-muted-foreground" />
              </div>
              <div>
                <div class="text-xs text-muted-foreground">Username</div>
                <div class="text-sm font-semibold">{{ username }}</div>
              </div>
            </div>
          </div>
        </section>

        <!-- Security -->
        <section>
          <h3 class="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest mb-3">Security</h3>
          <div class="p-4 rounded-lg border border-border bg-card space-y-3">
            <div class="flex items-center gap-2 mb-1">
              <Lock class="w-4 h-4 text-muted-foreground" />
              <span class="text-sm font-medium">Change password</span>
            </div>
            <Input
              type="password"
              placeholder="Current password"
              v-model="currentPassword"
              :disabled="loading"
              autocomplete="current-password"
            />
            <Input
              type="password"
              placeholder="New password (min 6 chars)"
              v-model="newPassword"
              :disabled="loading"
              autocomplete="new-password"
            />
            <Input
              type="password"
              placeholder="Confirm new password"
              v-model="confirmPassword"
              :disabled="loading"
              autocomplete="new-password"
              @keydown.enter="handleChangePassword"
            />
            <p v-if="passwordError" class="text-xs text-destructive">{{ passwordError }}</p>
            <p v-if="passwordSuccess" class="text-xs text-emerald-600">{{ passwordSuccess }}</p>
            <Button class="w-full" :disabled="loading" @click="handleChangePassword">
              {{ loading ? 'Updating…' : 'Update Password' }}
            </Button>
          </div>
        </section>

      </div>
    </div>
  </div>
</template>
