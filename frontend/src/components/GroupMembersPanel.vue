<script setup>
import { ref, computed } from 'vue'
import { useGroups } from '@/composables/useGroups'
import { useAuth } from '@/composables/useAuth'
import Button from '@/components/ui/button/Button.vue'
import Input from '@/components/ui/input/Input.vue'
import { Shield, UserPlus, UserMinus, Crown, Pencil, Trash2, LogOut, Check, X } from 'lucide-vue-next'

const props = defineProps({
  groupId: { type: Number, required: true },
  members: { type: Array, default: () => [] },
  myRole: { type: String, default: 'member' },
  group: { type: Object, default: null },
})
const emit = defineEmits(['close'])

const { username } = useAuth()
const { inviteMember, removeMember, leaveGroup, deleteGroup, updateGroup, updateMemberRole, activeGroupId } = useGroups()

// Edit group info
const editing = ref(false)
const editName = ref('')
const editDescription = ref('')
const editError = ref('')
const editLoading = ref(false)

function startEdit() {
  editName.value = props.group?.name ?? ''
  editDescription.value = props.group?.description ?? ''
  editError.value = ''
  editing.value = true
}

async function saveEdit() {
  if (!editName.value.trim()) { editError.value = 'Name is required'; return }
  editLoading.value = true
  try {
    await updateGroup(props.groupId, editName.value.trim(), editDescription.value.trim())
    editing.value = false
  } catch (err) {
    editError.value = err.message
  } finally {
    editLoading.value = false
  }
}

// Invite
const inviteInput = ref('')
const inviteError = ref('')
const inviteSuccess = ref('')
const inviteLoading = ref(false)

async function handleInvite() {
  if (!inviteInput.value.trim()) return
  inviteError.value = ''
  inviteSuccess.value = ''
  inviteLoading.value = true
  try {
    await inviteMember(props.groupId, inviteInput.value.trim())
    inviteSuccess.value = `${inviteInput.value.trim()} invited!`
    inviteInput.value = ''
  } catch (err) {
    inviteError.value = err.message
  } finally {
    inviteLoading.value = false
  }
}

// Remove member
const removeLoading = ref(null)
async function handleRemove(memberUsername) {
  removeLoading.value = memberUsername
  try {
    await removeMember(props.groupId, memberUsername)
  } catch { /* ignore */ } finally {
    removeLoading.value = null
  }
}

// Role change
const roleLoading = ref(null)
async function toggleRole(member) {
  const newRole = member.role === 'admin' ? 'member' : 'admin'
  roleLoading.value = member.username
  try {
    await updateMemberRole(props.groupId, member.username, newRole)
  } catch { /* ignore */ } finally {
    roleLoading.value = null
  }
}

// Leave
const actionLoading = ref(false)
async function handleLeave() {
  actionLoading.value = true
  try {
    await leaveGroup(props.groupId)
    activeGroupId.value = null
    emit('close')
  } catch { /* ignore */ } finally {
    actionLoading.value = false
  }
}

// Delete
async function handleDelete() {
  if (!confirm(`Delete "${props.group?.name}"? This cannot be undone.`)) return
  actionLoading.value = true
  try {
    await deleteGroup(props.groupId)
    activeGroupId.value = null
    emit('close')
  } catch { /* ignore */ } finally {
    actionLoading.value = false
  }
}

const isCreator = computed(() => props.group?.creator === username.value)
</script>

<template>
  <div class="w-60 flex-shrink-0 border-l border-border flex flex-col overflow-y-auto" style="background: hsl(var(--muted) / 0.3)">

    <!-- Header -->
    <div class="h-12 px-3 flex items-center gap-2 border-b border-border flex-shrink-0">
      <span class="text-xs font-semibold text-muted-foreground uppercase tracking-widest flex-1">Members</span>
      <button class="p-1 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors" @click="$emit('close')">
        <X class="w-3.5 h-3.5" />
      </button>
    </div>

    <div class="flex-1 p-3 space-y-5 overflow-y-auto">

      <!-- Group info -->
      <section>
        <div v-if="!editing">
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0">
              <p class="text-sm font-semibold truncate">{{ group?.name }}</p>
              <p v-if="group?.description" class="text-xs text-muted-foreground mt-0.5 break-words">{{ group.description }}</p>
            </div>
            <button
              v-if="myRole === 'admin'"
              class="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors flex-shrink-0"
              @click="startEdit"
            >
              <Pencil class="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        <!-- Edit form -->
        <div v-else class="space-y-2">
          <Input v-model="editName" placeholder="Group name" :disabled="editLoading" class="text-sm" />
          <Input v-model="editDescription" placeholder="Description (optional)" :disabled="editLoading" class="text-sm" />
          <p v-if="editError" class="text-xs text-destructive">{{ editError }}</p>
          <div class="flex gap-1.5">
            <Button size="sm" class="flex-1 h-7 text-xs" :disabled="editLoading" @click="saveEdit">
              <Check class="w-3 h-3 mr-1" /> Save
            </Button>
            <Button size="sm" variant="outline" class="h-7 text-xs px-2" @click="editing = false">
              <X class="w-3 h-3" />
            </Button>
          </div>
        </div>
      </section>

      <!-- Member list -->
      <section>
        <p class="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest mb-2">
          {{ members.length }} {{ members.length === 1 ? 'member' : 'members' }}
        </p>
        <div class="space-y-1">
          <div
            v-for="member in members"
            :key="member.username"
            class="flex items-center gap-2 py-1 px-1 rounded-md hover:bg-accent/50 transition-colors group/m"
          >
            <!-- Avatar dot -->
            <div class="w-5 h-5 rounded-full bg-muted-foreground/20 flex items-center justify-center flex-shrink-0">
              <span class="text-[9px] font-bold text-muted-foreground">{{ member.username.slice(0,1).toUpperCase() }}</span>
            </div>

            <span class="text-xs truncate flex-1" :class="member.username === username ? 'font-semibold' : ''">
              {{ member.username }}
              <span v-if="member.username === username" class="text-muted-foreground font-normal"> (you)</span>
            </span>

            <!-- Role badge -->
            <Crown v-if="member.username === group?.creator" class="w-3 h-3 text-amber-500 flex-shrink-0" title="Creator" />
            <Shield v-else-if="member.role === 'admin'" class="w-3 h-3 text-violet-500 flex-shrink-0" title="Admin" />

            <!-- Admin actions (hidden until hover) -->
            <div v-if="myRole === 'admin' && member.username !== username" class="hidden group-hover/m:flex items-center gap-0.5">
              <!-- Toggle admin (creator only) -->
              <button
                v-if="isCreator && member.username !== group?.creator"
                class="p-0.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                :title="member.role === 'admin' ? 'Remove admin' : 'Make admin'"
                :disabled="roleLoading === member.username"
                @click="toggleRole(member)"
              >
                <Shield class="w-3 h-3" :class="member.role === 'admin' ? 'text-violet-500' : ''" />
              </button>
              <!-- Remove member -->
              <button
                v-if="member.username !== group?.creator"
                class="p-0.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                title="Remove"
                :disabled="removeLoading === member.username"
                @click="handleRemove(member.username)"
              >
                <UserMinus class="w-3 h-3" />
              </button>
            </div>
          </div>
        </div>
      </section>

      <!-- Invite (admin only) -->
      <section v-if="myRole === 'admin'">
        <p class="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest mb-2">Invite</p>
        <div class="flex gap-1.5">
          <Input
            v-model="inviteInput"
            placeholder="Username"
            class="text-xs h-8"
            :disabled="inviteLoading"
            @keydown.enter="handleInvite"
          />
          <Button size="icon" class="h-8 w-8 flex-shrink-0" :disabled="inviteLoading || !inviteInput.trim()" @click="handleInvite">
            <UserPlus class="w-3.5 h-3.5" />
          </Button>
        </div>
        <p v-if="inviteError" class="text-xs text-destructive mt-1">{{ inviteError }}</p>
        <p v-if="inviteSuccess" class="text-xs text-emerald-600 mt-1">{{ inviteSuccess }}</p>
      </section>

      <!-- Danger zone -->
      <section class="pt-2 border-t border-border space-y-1.5">
        <!-- Leave (non-creator members) -->
        <button
          v-if="!isCreator"
          class="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
          :disabled="actionLoading"
          @click="handleLeave"
        >
          <LogOut class="w-3.5 h-3.5" />
          Leave group
        </button>
        <!-- Delete (creator only) -->
        <button
          v-if="isCreator"
          class="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
          :disabled="actionLoading"
          @click="handleDelete"
        >
          <Trash2 class="w-3.5 h-3.5" />
          Delete group
        </button>
      </section>

    </div>
  </div>
</template>
