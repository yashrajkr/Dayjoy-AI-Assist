import { useCallback, useEffect, useState } from "react";
import {
  MessageSquare, Mail, Smartphone, Bell, Inbox, Send, Search, Filter,
  CheckCircle, Clock, AlertTriangle, Loader2, RefreshCw, User, Phone,
  Mail as MailIcon, Trash2, Edit, Plus, X, Zap,
} from "lucide-react";
import { PageHeader, Card, StatCard, LoadingState, ErrorState, EmptyState, btnClass, StatusPill } from "../common/AdminUI";
import { Modal, modalButtonClass } from "../common/Modal";
import {
  commListChannels, commListConversations, commListMessages, commSendMessage,
  commAssignConversation, commUpdateConversationStatus,
  type Channel, type Conversation,
} from "../../../lib/api";
import { useAuth } from "../../lib/AuthContext";

const CHANNEL_ICONS: Record<string, typeof MessageSquare> = {
  whatsapp: MessageSquare, email: Mail, sms: Smartphone, push: Bell, in_app: Inbox,
};

const CHANNEL_COLORS: Record<string, string> = {
  whatsapp: "text-green-500", email: "text-blue-500", sms: "text-purple-500",
  push: "text-orange-500", in_app: "text-primary",
};

type Tab = "conversations" | "channels";

export function CommunicationCenter() {
  const { currentUser } = useAuth();
  const [tab, setTab] = useState<Tab>("conversations");
  const [channels, setChannels] = useState<Channel[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConv, setSelectedConv] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Array<Record<string, unknown>>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [channelFilter, setChannelFilter] = useState("");
  const [replyText, setReplyText] = useState("");
  const [sending, setSending] = useState(false);
  const [msgLoading, setMsgLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [chans, convs] = await Promise.all([
        commListChannels().catch(() => []),
        commListConversations({
          search: search || undefined,
          status: statusFilter || undefined,
          channel_type: channelFilter || undefined,
          limit: 50,
        }).catch(() => ({ conversations: [], total: 0, unread_total: 0 })),
      ]);
      setChannels(chans);
      setConversations(convs.conversations);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter, channelFilter]);

  useEffect(() => { load(); }, [load]);

  const openConversation = async (conv: Conversation) => {
    setSelectedConv(conv);
    setMessages([]);
    setMsgLoading(true);
    try {
      const msgs = await commListMessages(conv.id);
      setMessages(msgs);
    } catch { /* ignore */ } finally { setMsgLoading(false); }
  };

  const handleSend = async () => {
    if (!selectedConv || !replyText.trim()) return;
    setSending(true);
    try {
      await commSendMessage(selectedConv.id, replyText.trim(), "agent");
      const msgs = await commListMessages(selectedConv.id);
      setMessages(msgs);
      setReplyText("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to send");
    } finally { setSending(false); }
  };

  const handleStatus = async (conv: Conversation, status: string) => {
    try {
      await commUpdateConversationStatus(conv.id, status);
      await load();
      if (selectedConv?.id === conv.id) setSelectedConv({ ...conv, status });
    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
  };

  const handleAssign = async (conv: Conversation) => {
    if (!currentUser?.id) return;
    try {
      await commAssignConversation(conv.id, currentUser.id);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
  };

  const enabledChannels = channels.filter((c) => c.is_enabled);
  const activeConvs = conversations.filter((c) => c.status === "active");
  const unreadTotal = conversations.reduce((sum, c) => sum + (c.unread_count || 0), 0);

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto">
      <PageHeader
        title="Communication Center"
        description="Omnichannel hub — WhatsApp, Email, SMS, Push, and In-App notifications"
        icon={<MessageSquare className="w-5 h-5" />}
        actions={<button type="button" className={btnClass.secondary} onClick={load}><RefreshCw className="w-4 h-4" /> Refresh</button>}
      />

      {error ? <ErrorState message={error} /> : null}

      {/* KPI cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <StatCard label="Active Channels" value={enabledChannels.length} icon={<Zap className="w-5 h-5" />} />
        <StatCard label="Active Conversations" value={activeConvs.length} icon={<MessageSquare className="w-5 h-5" />} />
        <StatCard label="Unread Messages" value={unreadTotal} icon={<Bell className="w-5 h-5" />} />
        <StatCard label="Total Conversations" value={conversations.length} icon={<Inbox className="w-5 h-5" />} />
      </div>

      {/* Channel status pills */}
      <div className="flex flex-wrap gap-2 mb-4">
        {channels.map((ch) => {
          const Icon = CHANNEL_ICONS[ch.channel_type] || Inbox;
          return (
            <div key={ch.id} className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs border ${ch.is_enabled ? "border-primary/30 bg-primary/5" : "border-border bg-accent/30 opacity-60"}`}>
              <Icon className={`w-3 h-3 ${CHANNEL_COLORS[ch.channel_type] || "text-muted-foreground"}`} />
              <span>{ch.display_name}</span>
              <span className={`w-1.5 h-1.5 rounded-full ${ch.health_status === "healthy" ? "bg-primary" : ch.health_status === "degraded" ? "bg-warning" : ch.health_status === "down" ? "bg-destructive" : "bg-muted-foreground"}`} />
            </div>
          );
        })}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 border-b border-border">
        <button type="button" onClick={() => setTab("conversations")} className={`px-3 py-2 text-sm border-b-2 ${tab === "conversations" ? "border-primary text-primary font-medium" : "border-transparent text-muted-foreground"}`}>
          Conversations
        </button>
        <button type="button" onClick={() => setTab("channels")} className={`px-3 py-2 text-sm border-b-2 ${tab === "channels" ? "border-primary text-primary font-medium" : "border-transparent text-muted-foreground"}`}>
          Channels
        </button>
      </div>

      {loading ? <LoadingState /> : null}

      {/* Conversations tab */}
      {tab === "conversations" && !loading ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Conversation list */}
          <div className="lg:col-span-1 space-y-2">
            <div className="flex gap-2 mb-2">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-muted-foreground" />
                <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search…"
                  className="w-full pl-8 pr-3 py-2 rounded-lg border border-border bg-card text-xs focus:outline-none focus:ring-2 focus:ring-primary/40" />
              </div>
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="px-2 py-2 rounded-lg border border-border bg-card text-xs">
                <option value="">All</option>
                <option value="active">Active</option>
                <option value="pending">Pending</option>
                <option value="resolved">Resolved</option>
                <option value="closed">Closed</option>
              </select>
            </div>
            {conversations.length === 0 ? <Card><EmptyState title="No conversations" icon={<Inbox className="w-5 h-5" />} /></Card> : (
              <div className="space-y-1.5 max-h-[600px] overflow-y-auto">
                {conversations.map((conv) => {
                  const Icon = CHANNEL_ICONS[conv.channel_type] || Inbox;
                  const isSelected = selectedConv?.id === conv.id;
                  return (
                    <button key={conv.id} type="button" onClick={() => openConversation(conv)}
                      className={`w-full text-left p-2.5 rounded-lg border transition-colors ${isSelected ? "border-primary bg-primary/5" : "border-border hover:bg-accent/30"}`}>
                      <div className="flex items-center gap-2 mb-1">
                        <Icon className={`w-3.5 h-3.5 shrink-0 ${CHANNEL_COLORS[conv.channel_type]}`} />
                        <span className="text-sm font-medium truncate flex-1">{conv.customer_name || conv.customer_phone || "Unknown"}</span>
                        {conv.unread_count > 0 ? <span className="text-[9px] bg-primary text-primary-foreground px-1.5 py-0.5 rounded-full">{conv.unread_count}</span> : null}
                      </div>
                      <p className="text-[10px] text-muted-foreground truncate">{conv.last_message_preview || conv.subject || "No messages"}</p>
                      <div className="flex items-center gap-1.5 mt-1">
                        <StatusPill status={conv.status} />
                        {conv.ai_handled ? <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary">AI</span> : null}
                        <span className="text-[9px] text-muted-foreground ml-auto">{conv.last_message_at ? new Date(conv.last_message_at).toLocaleDateString() : ""}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Message thread */}
          <div className="lg:col-span-2">
            {selectedConv ? (
              <Card className="p-0 flex flex-col h-[600px]">
                {/* Thread header */}
                <div className="px-4 py-3 border-b border-border flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{selectedConv.customer_name || selectedConv.customer_phone || "Conversation"}</p>
                    <p className="text-[10px] text-muted-foreground">{selectedConv.channel_type} · {selectedConv.status}</p>
                  </div>
                  {selectedConv.status === "active" ? (
                    <>
                      <button type="button" onClick={() => handleAssign(selectedConv)} className="text-xs px-2 py-1 rounded border border-border hover:bg-accent">Assign to me</button>
                      <button type="button" onClick={() => handleStatus(selectedConv, "resolved")} className="text-xs px-2 py-1 rounded border border-primary/30 text-primary hover:bg-primary/10">Resolve</button>
                    </>
                  ) : null}
                </div>
                {/* Messages */}
                <div className="flex-1 overflow-y-auto p-4 space-y-2">
                  {msgLoading ? <LoadingState /> : messages.length === 0 ? <p className="text-xs text-muted-foreground text-center py-8">No messages yet</p> : (
                    messages.map((m) => {
                      const isCustomer = m.sender_type === "customer";
                      return (
                        <div key={String(m.id)} className={`flex ${isCustomer ? "justify-start" : "justify-end"}`}>
                          <div className={`max-w-[75%] rounded-lg px-3 py-2 text-sm ${isCustomer ? "bg-accent" : "bg-primary text-primary-foreground"}`}>
                            <p className="text-xs">{String(m.body || "")}</p>
                            <div className="flex items-center gap-1 mt-0.5">
                              <span className={`text-[9px] ${isCustomer ? "text-muted-foreground" : "text-primary-foreground/70"}`}>
                                {String(m.sender_type ?? "")} · {m.created_at ? new Date(String(m.created_at)).toLocaleTimeString() : ""}
                              </span>
                              {m.ai_generated ? <span className="text-[8px] px-1 rounded bg-primary-foreground/20">AI</span> : null}
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
                {/* Reply box */}
                <div className="px-3 py-2 border-t border-border flex gap-2">
                  <input type="text" value={replyText} onChange={(e) => setReplyText(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                    placeholder="Type a reply…" className="flex-1 px-3 py-1.5 rounded-lg border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" />
                  <button type="button" onClick={handleSend} disabled={sending || !replyText.trim()} className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-sm hover:opacity-90 disabled:opacity-50">
                    {sending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </Card>
            ) : (
              <Card><EmptyState title="Select a conversation" description="Choose a conversation from the list to view messages." icon={<MessageSquare className="w-5 h-5" />} /></Card>
            )}
          </div>
        </div>
      ) : null}

      {/* Channels tab */}
      {tab === "channels" && !loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {channels.map((ch) => {
            const Icon = CHANNEL_ICONS[ch.channel_type] || Inbox;
            return (
              <Card key={ch.id}>
                <div className="flex items-start gap-3 mb-2">
                  <div className={`w-10 h-10 rounded-lg bg-accent flex items-center justify-center shrink-0`}>
                    <Icon className={`w-5 h-5 ${CHANNEL_COLORS[ch.channel_type]}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{ch.display_name}</p>
                    <p className="text-[10px] text-muted-foreground capitalize">{ch.provider || "Not configured"}</p>
                  </div>
                  <span className={`w-2 h-2 rounded-full ${ch.is_enabled ? "bg-primary" : "bg-muted-foreground"}`} />
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div><span className="text-muted-foreground">Status:</span> <span className="font-medium capitalize">{ch.health_status}</span></div>
                  <div><span className="text-muted-foreground">Daily Limit:</span> <span className="font-medium">{ch.daily_limit}</span></div>
                  <div><span className="text-muted-foreground">Sent Today:</span> <span className="font-medium">{ch.sent_today}</span></div>
                  <div><span className="text-muted-foreground">Enabled:</span> <span className={`font-medium ${ch.is_enabled ? "text-primary" : "text-muted-foreground"}`}>{ch.is_enabled ? "Yes" : "No"}</span></div>
                </div>
              </Card>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
