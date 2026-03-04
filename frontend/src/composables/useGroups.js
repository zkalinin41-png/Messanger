import { ref } from 'vue'
import { useAuth } from './useAuth'

// Module-level shared state
export const groups = ref([])
export const groupMessages = ref({})   // { [groupId]: Message[] }
export const groupMembers = ref({})    // { [groupId]: Member[] }
export const activeGroupId = ref(null) // currently open group (null = general chat)

export function useGroups() {
  const { token } = useAuth()

  function authHeaders() {
    return { Authorization: `Bearer ${token.value}` }
  }

  async function fetchGroups() {
    const res = await fetch('/api/groups', { headers: authHeaders() })
    if (!res.ok) return
    const data = await res.json()
    groups.value = data.groups
  }

  async function fetchGroupDetails(groupId) {
    const res = await fetch(`/api/groups/${groupId}`, { headers: authHeaders() })
    if (!res.ok) return
    const data = await res.json()
    groupMembers.value[groupId] = data.members
  }

  async function fetchMessages(groupId) {
    const res = await fetch(`/api/groups/${groupId}/messages`, { headers: authHeaders() })
    if (!res.ok) return
    const data = await res.json()
    groupMessages.value[groupId] = data.messages
    // Clear unread count — server marked as read
    const g = groups.value.find(g => g.id === groupId)
    if (g) g.unread_count = 0
  }

  async function createGroup(name, description) {
    const res = await fetch('/api/groups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ name, description }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error)
    groups.value.unshift(data.group)
    return data.group
  }

  async function updateGroup(groupId, name, description) {
    const res = await fetch(`/api/groups/${groupId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ name, description }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error)
    const g = groups.value.find(g => g.id === groupId)
    if (g) { g.name = name; g.description = description }
  }

  async function deleteGroup(groupId) {
    const res = await fetch(`/api/groups/${groupId}`, {
      method: 'DELETE',
      headers: authHeaders(),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error)
    _removeGroup(groupId)
  }

  async function inviteMember(groupId, username) {
    const res = await fetch(`/api/groups/${groupId}/members`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ username }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error)
    return data
  }

  async function removeMember(groupId, username) {
    const res = await fetch(`/api/groups/${groupId}/members/${username}`, {
      method: 'DELETE',
      headers: authHeaders(),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error)
    if (groupMembers.value[groupId]) {
      groupMembers.value[groupId] = groupMembers.value[groupId].filter(m => m.username !== username)
    }
  }

  async function leaveGroup(groupId) {
    const res = await fetch(`/api/groups/${groupId}/leave`, {
      method: 'DELETE',
      headers: authHeaders(),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error)
    _removeGroup(groupId)
  }

  async function updateMemberRole(groupId, username, role) {
    const res = await fetch(`/api/groups/${groupId}/members/${username}/role`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ role }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error)
    if (groupMembers.value[groupId]) {
      const m = groupMembers.value[groupId].find(m => m.username === username)
      if (m) m.role = role
    }
  }

  function _removeGroup(groupId) {
    groups.value = groups.value.filter(g => g.id !== groupId)
    delete groupMessages.value[groupId]
    delete groupMembers.value[groupId]
  }

  return {
    groups, groupMessages, groupMembers, activeGroupId,
    fetchGroups, fetchGroupDetails, fetchMessages,
    createGroup, updateGroup, deleteGroup,
    inviteMember, removeMember, leaveGroup, updateMemberRole,
  }
}
