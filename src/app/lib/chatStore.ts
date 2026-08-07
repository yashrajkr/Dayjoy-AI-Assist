import { supabase } from "./supabaseClient";

/**
 * Chat persistence layer — backed by the `chat_conversations` and
 * `chat_messages` tables (see `supabase_schema_v2.sql`).
 *
 * When Supabase is not configured, every function degrades gracefully to
 * an in-memory session so the UI remains usable in demo mode.
 */

export type Conversation = {
  id: string;
  title: string;
  pinned?: boolean;
  archived?: boolean;
  language?: string | null;
  created_at?: string;
  updated_at?: string;
};

export type ChatMessage = {
  id?: string;
  conversation_id?: string;
  role: "user" | "assistant" | "system";
  content: string;
  sources?: unknown;
  safety_status?: string | null;
  handoff_required?: boolean | null;
  confidence?: number | null;
  feedback?: "up" | "down" | null;
  feedback_comment?: string | null;
  created_at?: string;
  // ---- RAG enrichment (added in v2.1) ----
  verification_status?: "verified" | "partial" | "unverified" | null;
  handoff_message?: string | null;
  rag_metadata?: unknown;
  // Set on the client when the message rendered from a stream but its
  // Supabase persistence write failed — never sent to/from the backend.
  _unsaved?: boolean;
};

/** In-memory fallback when Supabase is unavailable. */
const memoryConversations: Conversation[] = [];
const memoryMessages: ChatMessage[] = [];

export async function listConversations(userId: string): Promise<Conversation[]> {
  if (!supabase) {
    return [...memoryConversations];
  }
  try {
    const { data, error } = await supabase
      .from("chat_conversations")
      .select("*")
      .eq("user_id", userId)
      .order("pinned", { ascending: false })
      .order("updated_at", { ascending: false })
      .limit(50);
    if (error) throw error;
    return (data ?? []) as Conversation[];
  } catch (e) {
    console.warn("[chat] listConversations failed", e);
    return [...memoryConversations];
  }
}

export async function createConversation(
  userId: string,
  title = "New conversation",
  language = "English",
): Promise<Conversation | null> {
  if (!supabase) {
    const conv: Conversation = {
      id: `mem-${Date.now()}`,
      title,
      language,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    memoryConversations.unshift(conv);
    return conv;
  }
  try {
    const { data, error } = await supabase
      .from("chat_conversations")
      .insert({ user_id: userId, title, language })
      .select("*")
      .single();
    if (error) throw error;
    return data as Conversation;
  } catch (e) {
    console.warn("[chat] createConversation failed", e);
    return null;
  }
}

export async function renameConversation(conversationId: string, title: string): Promise<void> {
  if (!supabase) {
    const c = memoryConversations.find((x) => x.id === conversationId);
    if (c) c.title = title;
    return;
  }
  try {
    await supabase
      .from("chat_conversations")
      .update({ title })
      .eq("id", conversationId)
      .throwOnError();
  } catch (e) {
    console.warn("[chat] renameConversation failed", e);
  }
}

export async function archiveConversation(conversationId: string, archived: boolean): Promise<void> {
  if (!supabase) {
    const c = memoryConversations.find((x) => x.id === conversationId);
    if (c) c.archived = archived;
    return;
  }
  try {
    await supabase
      .from("chat_conversations")
      .update({ archived })
      .eq("id", conversationId)
      .throwOnError();
  } catch (e) {
    console.warn("[chat] archiveConversation failed", e);
  }
}

export async function pinConversation(conversationId: string, pinned: boolean): Promise<void> {
  if (!supabase) {
    const c = memoryConversations.find((x) => x.id === conversationId);
    if (c) c.pinned = pinned;
    return;
  }
  try {
    await supabase
      .from("chat_conversations")
      .update({ pinned })
      .eq("id", conversationId)
      .throwOnError();
  } catch (e) {
    console.warn("[chat] pinConversation failed", e);
  }
}

export async function deleteConversation(conversationId: string): Promise<void> {
  if (!supabase) {
    const i = memoryConversations.findIndex((x) => x.id === conversationId);
    if (i >= 0) memoryConversations.splice(i, 1);
    return;
  }
  try {
    await supabase.from("chat_conversations").delete().eq("id", conversationId).throwOnError();
  } catch (e) {
    console.warn("[chat] deleteConversation failed", e);
  }
}

export async function listMessages(conversationId: string): Promise<ChatMessage[]> {
  if (!supabase) {
    return memoryMessages.filter((m) => m.conversation_id === conversationId);
  }
  try {
    const { data, error } = await supabase
      .from("chat_messages")
      .select("*")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true })
      .limit(200);
    if (error) throw error;
    return (data ?? []) as ChatMessage[];
  } catch (e) {
    console.warn("[chat] listMessages failed", e);
    return [];
  }
}

export async function appendMessage(
  conversationId: string,
  msg: Omit<ChatMessage, "id" | "conversation_id" | "created_at">,
): Promise<ChatMessage | null> {
  if (!supabase) {
    const m: ChatMessage = {
      ...msg,
      id: `mem-${Date.now()}`,
      conversation_id: conversationId,
      created_at: new Date().toISOString(),
    };
    memoryMessages.push(m);
    return m;
  }
  try {
    const { data, error } = await supabase
      .from("chat_messages")
      .insert({ conversation_id: conversationId, ...msg })
      .select("*")
      .single();
    if (error) throw error;
    return data as ChatMessage;
  } catch (e) {
    console.warn("[chat] appendMessage failed", e);
    return null;
  }
}

export async function setMessageFeedback(
  messageId: string,
  feedback: "up" | "down",
  comment?: string,
): Promise<void> {
  if (!supabase) {
    const m = memoryMessages.find((x) => x.id === messageId);
    if (m) {
      m.feedback = feedback;
      m.feedback_comment = comment ?? null;
    }
    return;
  }
  try {
    await supabase
      .from("chat_messages")
      .update({ feedback, feedback_comment: comment ?? null })
      .eq("id", messageId)
      .throwOnError();
  } catch (e) {
    console.warn("[chat] setMessageFeedback failed", e);
  }
}

/** Auto-title a conversation from the first user message. */
export function deriveTitle(text: string, maxLen = 48): string {
  const trimmed = text.trim().replace(/\s+/g, " ");
  if (trimmed.length <= maxLen) return trimmed;
  return trimmed.slice(0, maxLen - 1) + "…";
}

/**
 * True when a conversation's title is still the default placeholder — i.e.
 * it has never been auto-titled or manually renamed. Auto-titling flows
 * (UserChat, VoiceAssistant) must check this before overwriting a title so
 * a manual rename is never silently clobbered by a later AI suggestion.
 */
export function hasDefaultTitle(title: string | null | undefined): boolean {
  return !title || title === "New conversation";
}
