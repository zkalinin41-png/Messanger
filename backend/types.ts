// ── Database Row Types ───────────────────────────────────────────────────────

export interface UserRow {
    id: number
    username: string
    password_hash: string
    created_at: string
    email: string | null
    email_verified: number
    verification_token: string | null
    verification_expires: number | null
    reset_token: string | null
    reset_expires: number | null
    last_seen_at: number | null
    avatar_url: string | null
}

export interface GroupRow {
    id: number
    name: string
    description: string
    creator: string
    created_at: number
}

export interface GroupMemberRow {
    group_id: number
    username: string
    role: 'admin' | 'member'
    last_seen_at: number
}

export interface GroupMessageRow {
    id: number
    group_id: number
    username: string
    text: string
    timestamp: number
    reply_to_id: number | null
    reply_to_text: string | null
    reply_to_username: string | null
    file_url: string | null
    file_name: string | null
    file_type: string | null
    file_size: number | null
    edited: number
    deleted: number
}

export interface DMMessageRow {
    id: number
    from_user: string
    to_user: string
    text: string
    timestamp: number
    status: 'sent' | 'delivered' | 'read'
    reply_to_id: number | null
    reply_to_text: string | null
    reply_to_username: string | null
    file_url: string | null
    file_name: string | null
    file_type: string | null
    file_size: number | null
    edited: number
    deleted: number
}

export interface ReactionRow {
    id: number
    message_id: number
    message_type: string
    username: string
    emoji: string
    created_at: number
}

export interface PinnedMessageRow {
    id: number
    group_id: number
    message_id: number
    pinned_by: string
    pinned_at: number
}

export interface BlockedUserRow {
    id: number
    blocker: string
    blocked: string
    created_at: number
}

// ── WebSocket Client ─────────────────────────────────────────────────────────

export interface WsClient {
    username: string
    color: string
}

// ── Chat Message (in-memory general chat) ────────────────────────────────────

export interface ChatMessage {
    id?: number
    type?: string
    username?: string
    color?: string
    text?: string
    message?: string
    timestamp: number
}

// ── Aggregated Reaction ──────────────────────────────────────────────────────

export interface AggregatedReaction {
    emoji: string
    users: string[]
}

// ── Auth Payload ─────────────────────────────────────────────────────────────

export interface AuthPayload {
    username: string
    iat?: number
    exp?: number
}

// ── WebSocket Message Types ──────────────────────────────────────────────────

export interface WsJoinMessage {
    type: 'join'
    token: string
}

export interface WsTypingMessage {
    type: 'typing'
    isTyping: boolean
}

export interface WsChatMessage {
    type: 'message'
    text: string
}

export interface WsGroupMessage {
    type: 'group_message'
    groupId: number
    text: string
    reply_to_id?: number
    reply_to_text?: string
    reply_to_username?: string
    file_url?: string
    file_name?: string
    file_type?: string
    file_size?: number
}

export interface WsDmTypingMessage {
    type: 'dm_typing'
    toUser: string
    isTyping: boolean
}

export interface WsGroupTypingMessage {
    type: 'group_typing'
    groupId: number
    isTyping: boolean
}

export interface WsCallMessage {
    type: 'call_invite' | 'call_accept' | 'call_reject' | 'call_end'
    toUser: string
    callMode?: string
}

export type WsIncomingMessage =
    | WsJoinMessage
    | WsTypingMessage
    | WsChatMessage
    | WsGroupMessage
    | WsDmTypingMessage
    | WsGroupTypingMessage
    | WsCallMessage
