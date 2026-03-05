import { ref, type Ref } from 'vue'
import { useAuth } from './useAuth'
import type { Group, GroupMessage, GroupMember } from '../types'

// Module-level shared state
export const groups: Ref<Group[]> = ref([])
export const groupMessages: Ref<Record<number, GroupMessage[]>> = ref({})
export const groupMembers: Ref<Record<number, GroupMember[]>> = ref({})
export const activeGroupId: Ref<number | null> = ref(null)

export function useGroups() {
    const { token } = useAuth()

    function authHeaders(): Record<string, string> {
        return { Authorization: `Bearer ${token.value}` }
    }

    async function fetchGroups(): Promise<void> {
        const res = await fetch('/api/groups', { headers: authHeaders() })
        if (!res.ok) return
        const data = await res.json()
        groups.value = data.groups
    }

    async function fetchGroupDetails(groupId: number): Promise<void> {
        const res = await fetch(`/api/groups/${groupId}`, { headers: authHeaders() })
        if (!res.ok) return
        const data = await res.json()
        groupMembers.value[groupId] = data.members
    }

    async function fetchMessages(groupId: number): Promise<void> {
        const res = await fetch(`/api/groups/${groupId}/messages`, { headers: authHeaders() })
        if (!res.ok) return
        const data = await res.json()
        groupMessages.value[groupId] = data.messages
        const g = groups.value.find((g: Group) => g.id === groupId)
        if (g) g.unread_count = 0
    }

    async function createGroup(name: string, description: string): Promise<Group> {
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

    async function updateGroup(groupId: number, name: string, description: string): Promise<void> {
        const res = await fetch(`/api/groups/${groupId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', ...authHeaders() },
            body: JSON.stringify({ name, description }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error)
        const g = groups.value.find((g: Group) => g.id === groupId)
        if (g) { g.name = name; g.description = description }
    }

    async function deleteGroup(groupId: number): Promise<void> {
        const res = await fetch(`/api/groups/${groupId}`, {
            method: 'DELETE',
            headers: authHeaders(),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error)
        _removeGroup(groupId)
    }

    async function inviteMember(groupId: number, username: string): Promise<any> {
        const res = await fetch(`/api/groups/${groupId}/members`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authHeaders() },
            body: JSON.stringify({ username }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error)
        return data
    }

    async function removeMember(groupId: number, username: string): Promise<void> {
        const res = await fetch(`/api/groups/${groupId}/members/${username}`, {
            method: 'DELETE',
            headers: authHeaders(),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error)
        if (groupMembers.value[groupId]) {
            groupMembers.value[groupId] = groupMembers.value[groupId].filter((m: GroupMember) => m.username !== username)
        }
    }

    async function leaveGroup(groupId: number): Promise<void> {
        const res = await fetch(`/api/groups/${groupId}/leave`, {
            method: 'DELETE',
            headers: authHeaders(),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error)
        _removeGroup(groupId)
    }

    async function updateMemberRole(groupId: number, username: string, role: string): Promise<void> {
        const res = await fetch(`/api/groups/${groupId}/members/${username}/role`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', ...authHeaders() },
            body: JSON.stringify({ role }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error)
        if (groupMembers.value[groupId]) {
            const m = groupMembers.value[groupId].find((m: GroupMember) => m.username === username)
            if (m) m.role = role as 'admin' | 'member'
        }
    }

    function _removeGroup(groupId: number): void {
        groups.value = groups.value.filter((g: Group) => g.id !== groupId)
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
