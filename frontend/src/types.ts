// ── Message Types ────────────────────────────────────────────────────────────

export interface Reaction {
    emoji: string
    users: string[]
}

export interface BaseMessage {
    id: number
    text: string
    timestamp: number
    color?: string
    edited?: number
    deleted?: number
    file_url?: string | null
    file_name?: string | null
    file_type?: string | null
    file_size?: number | null
    reply_to_id?: number | null
    reply_to_text?: string | null
    reply_to_username?: string | null
    reactions?: Reaction[]
}

export interface DMMessage extends BaseMessage {
    from_user: string
    to_user: string
    status: 'sent' | 'delivered' | 'read'
}

export interface GroupMessage extends BaseMessage {
    group_id: number
    username: string
}

export interface ChatMessage {
    id?: number
    type?: string
    username?: string
    color?: string
    text?: string
    message?: string
    timestamp: number
}

// ── Group Types ──────────────────────────────────────────────────────────────

export interface Group {
    id: number
    name: string
    description: string
    creator: string
    role?: string
    unread_count?: number
    member_count?: number
    created_at?: number
}

export interface GroupMember {
    username: string
    role: 'admin' | 'member'
}

// ── Conversation Types ───────────────────────────────────────────────────────

export interface Conversation {
    partner: string
    color: string
    last_text: string
    last_timestamp: number
    unread_count: number
    online: boolean
    last_seen_at: number | null
}

// ── User Types ───────────────────────────────────────────────────────────────

export interface User {
    username: string
    color?: string
    online?: boolean
    avatar_url?: string | null
    last_seen_at?: number | null
    created_at?: string
}

export interface OnlineUser {
    username: string
    color: string
}

export interface OnlineStatus {
    online: boolean
    lastSeen: number | null
}

// ── File Data ────────────────────────────────────────────────────────────────

export interface FileData {
    url: string
    name: string
    type: string
    size: number
}

// ── Reply To ─────────────────────────────────────────────────────────────────

export interface ReplyTo {
    id: number
    text?: string
    file_name?: string
    username?: string
    from_user?: string
}

// ── Pinned Message ───────────────────────────────────────────────────────────

export interface PinnedMessage {
    id: number
    group_id: number
    message_id: number
    pinned_by: string
    pinned_at: number
    text: string
    username: string
    msg_timestamp: number
    file_url?: string | null
    file_name?: string | null
    color?: string
}

// ── Media File ───────────────────────────────────────────────────────────────

export interface MediaFile {
    id: number
    from_user: string
    file_url: string
    file_name: string
    file_type: string
    file_size: number
    timestamp: number
}
