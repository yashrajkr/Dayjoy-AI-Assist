import { useCallback, useEffect, useState } from "react";
import {
  Bot, Brain, Loader2, Send, Save, X, Sparkles, MessageSquare,
  Trash2, Settings, Zap, Users,
} from "lucide-react";
import { PageHeader, Card, LoadingState, ErrorState, EmptyState, btnClass, StatusPill } from "../common/AdminUI";
import { Modal, modalButtonClass } from "../common/Modal";
import {
  agentList, agentUpdate, agentChat, agentCollaborate, agentMemory, agentMemoryDelete,
  type AIAgent,
} from "../../../lib/api";

const AGENT_TYPES: Record<string, { label: string; icon: string }> = {
  product_expert: { label: "Product Expert", icon: "📦" },
  support_agent: { label: "Support Agent", icon: "🎧" },
  sales_coach: { label: "Sales Coach", icon: "💼" },
  distributor_coach: { label: "Distributor Coach", icon: "🎯" },
  training_coach: { label: "Training Coach", icon: "🎓" },
  marketing_assistant: { label: "Marketing Assistant", icon: "📢" },
  content_creator: { label: "Content Creator", icon: "✍️" },
  knowledge_manager: { label: "Knowledge Manager", icon: "📚" },
  analytics_advisor: { label: "Analytics Advisor", icon: "📊" },
  executive_assistant: { label: "Executive Assistant", icon: "👔" },
  compliance_checker: { label: "Compliance Checker", icon: "🛡️" },
  workflow_planner: { label: "Workflow Planner", icon: "⚙️" },
};

export function AgentCenter() {
  const [agents, setAgents] = useState<AIAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedAgent, setSelectedAgent] = useState<AIAgent | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [collabOpen, setCollabOpen] = useState(false);

  // Chat state
  const [chatMessages, setChatMessages] = useState<Array<{ role: string; content: string }>>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);

  // Edit state
  const [editForm, setEditForm] = useState({ system_prompt: "", temperature: 0.3, max_tokens: 800, memory_enabled: true });

  // Memory state
  const [memories, setMemories] = useState<Array<Record<string, unknown>>>([]);

  // Collaboration state
  const [collabTopic, setCollabTopic] = useState("");
  const [collabQuery, setCollabQuery] = useState("");
  const [collabChain, setCollabChain] = useState<string[]>([]);
  const [collabResult, setCollabResult] = useState<Array<Record<string, unknown>> | null>(null);
  const [collabLoading, setCollabLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await agentList();
      setAgents(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const openChat = (agent: AIAgent) => {
    setSelectedAgent(agent);
    setChatMessages([]);
    setChatInput("");
    setChatOpen(true);
  };

  const openEdit = (agent: AIAgent) => {
    setSelectedAgent(agent);
    setEditForm({
      system_prompt: agent.system_prompt,
      temperature: agent.temperature,
      max_tokens: agent.max_tokens,
      memory_enabled: agent.memory_enabled,
    });
    setEditOpen(true);
  };

  const openMemory = async (agent: AIAgent) => {
    setSelectedAgent(agent);
    setMemoryOpen(true);
    try {
      const mem = await agentMemory(agent.id);
      setMemories(mem);
    } catch { setMemories([]); }
  };

  const handleChat = async () => {
    if (!selectedAgent || !chatInput.trim()) return;
    const msg = chatInput.trim();
    setChatMessages((prev) => [...prev, { role: "user", content: msg }]);
    setChatInput("");
    setChatLoading(true);
    try {
      const res = await agentChat(selectedAgent.id, msg);
      setChatMessages((prev) => [...prev, { role: "assistant", content: res.response }]);
    } catch (e) {
      setChatMessages((prev) => [...prev, { role: "assistant", content: "Error: " + (e instanceof Error ? e.message : "Failed") }]);
    } finally {
      setChatLoading(false);
    }
  };

  const handleSaveEdit = async () => {
    if (!selectedAgent) return;
    try {
      await agentUpdate(selectedAgent.id, editForm);
      setEditOpen(false);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
  };

  const handleCollaborate = async () => {
    if (!collabTopic.trim() || !collabQuery.trim() || collabChain.length === 0) return;
    setCollabLoading(true);
    setCollabResult(null);
    try {
      const res = await agentCollaborate({ topic: collabTopic, initial_query: collabQuery, agent_chain: collabChain });
      setCollabResult(res.messages);
    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); } finally { setCollabLoading(false); }
  };

  const toggleAgentInChain = (agentId: string) => {
    setCollabChain((prev) => prev.includes(agentId) ? prev.filter((id) => id !== agentId) : [...prev, agentId]);
  };

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto">
      <PageHeader
        title="AI Agent Center"
        description="12 specialized AI agents with memory, tools, and collaboration capabilities"
        icon={<Bot className="w-5 h-5" />}
        actions={<button type="button" className={btnClass.primary} onClick={() => { setCollabOpen(true); setCollabChain([]); setCollabResult(null); }}><Users className="w-4 h-4" /> Collaborate</button>}
      />

      {error ? <ErrorState message={error} /> : null}

      {loading ? <LoadingState /> : agents.length === 0 ? <Card><EmptyState title="No agents" icon={<Bot className="w-5 h-5" />} /></Card> : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {agents.map((agent) => {
            const typeInfo = AGENT_TYPES[agent.agent_type] || { label: agent.agent_type, icon: "🤖" };
            return (
              <Card key={agent.id}>
                <div className="flex items-start gap-3 mb-2">
                  <div className="w-11 h-11 rounded-xl flex items-center justify-center text-2xl shrink-0" style={{ backgroundColor: `${agent.color}20` }}>{agent.avatar || typeInfo.icon}</div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-medium">{agent.name}</h3>
                    <p className="text-[10px] text-muted-foreground">{typeInfo.label}</p>
                  </div>
                  <StatusPill status={agent.is_active ? "active" : "inactive"} />
                </div>
                <p className="text-xs text-muted-foreground line-clamp-2 mb-2">{agent.description || agent.system_prompt.slice(0, 100) + "..."}</p>
                <div className="flex items-center gap-1.5 mb-2 flex-wrap">
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-accent text-muted-foreground">{agent.model?.split("-").slice(0, 2).join("-")}</span>
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-accent text-muted-foreground">T={agent.temperature}</span>
                  {agent.memory_enabled ? <span className="text-[9px] px-1.5 py-0.5 rounded bg-primary/10 text-primary">Memory</span> : null}
                </div>
                <div className="flex gap-1">
                  <button type="button" onClick={() => openChat(agent)} className="flex-1 text-xs px-2 py-1.5 rounded-lg border border-primary/30 text-primary hover:bg-primary/10 flex items-center justify-center gap-1"><MessageSquare className="w-3 h-3" /> Chat</button>
                  <button type="button" onClick={() => openMemory(agent)} className="text-xs px-2 py-1.5 rounded-lg border border-border hover:bg-accent" title="Memory"><Brain className="w-3.5 h-3.5" /></button>
                  <button type="button" onClick={() => openEdit(agent)} className="text-xs px-2 py-1.5 rounded-lg border border-border hover:bg-accent" title="Settings"><Settings className="w-3.5 h-3.5" /></button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Chat Modal */}
      <Modal open={chatOpen} onClose={() => setChatOpen(false)} title={`Chat with ${selectedAgent?.name ?? "Agent"}`} size="md"
        footer={null}>
        <div className="space-y-2 mb-3 max-h-[400px] overflow-y-auto">
          {chatMessages.length === 0 ? <p className="text-xs text-muted-foreground text-center py-4">Start a conversation with {selectedAgent?.name}…</p> : (
            chatMessages.map((m, i) => (
              <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${m.role === "user" ? "bg-primary text-primary-foreground" : "bg-accent"}`}>
                  <p className="text-xs">{m.content}</p>
                </div>
              </div>
            ))
          )}
          {chatLoading ? <div className="flex justify-start"><div className="bg-accent rounded-lg px-3 py-2"><Loader2 className="w-4 h-4 animate-spin text-muted-foreground" /></div></div> : null}
        </div>
        <div className="flex gap-2">
          <input type="text" value={chatInput} onChange={(e) => setChatInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleChat(); }}
            placeholder="Type a message…" className="flex-1 px-3 py-2 rounded-lg border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" />
          <button type="button" onClick={handleChat} disabled={chatLoading || !chatInput.trim()} className="px-3 py-2 rounded-lg bg-primary text-primary-foreground text-sm hover:opacity-90 disabled:opacity-50">
            <Send className="w-4 h-4" />
          </button>
        </div>
      </Modal>

      {/* Edit Modal */}
      <Modal open={editOpen} onClose={() => setEditOpen(false)} title={`Configure ${selectedAgent?.name ?? "Agent"}`} size="md"
        footer={<><button type="button" className={modalButtonClass.secondary} onClick={() => setEditOpen(false)}><X className="w-4 h-4" /> Cancel</button>
          <button type="button" className={modalButtonClass.primary} onClick={handleSaveEdit}><Save className="w-4 h-4" /> Save</button></>}>
        <div className="space-y-3">
          <div><label className="block text-xs text-muted-foreground mb-1">System Prompt</label>
            <textarea value={editForm.system_prompt} onChange={(e) => setEditForm({ ...editForm, system_prompt: e.target.value })} rows={6} className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/40" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-xs text-muted-foreground mb-1">Temperature: {editForm.temperature.toFixed(2)}</label>
              <input type="range" min={0} max={2} step={0.05} value={editForm.temperature} onChange={(e) => setEditForm({ ...editForm, temperature: parseFloat(e.target.value) })} className="w-full" />
            </div>
            <div><label className="block text-xs text-muted-foreground mb-1">Max Tokens: {editForm.max_tokens}</label>
              <input type="range" min={100} max={4000} step={100} value={editForm.max_tokens} onChange={(e) => setEditForm({ ...editForm, max_tokens: parseInt(e.target.value) })} className="w-full" />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={editForm.memory_enabled} onChange={(e) => setEditForm({ ...editForm, memory_enabled: e.target.checked })} className="rounded" /> Memory enabled</label>
        </div>
      </Modal>

      {/* Memory Modal */}
      <Modal open={memoryOpen} onClose={() => setMemoryOpen(false)} title={`${selectedAgent?.name ?? "Agent"} Memory`} size="md"
        footer={<button type="button" className={modalButtonClass.secondary} onClick={() => setMemoryOpen(false)}>Close</button>}>
        {memories.length === 0 ? <p className="text-xs text-muted-foreground text-center py-4">No memories stored yet.</p> : (
          <div className="space-y-1.5 max-h-[400px] overflow-y-auto">
            {memories.map((m) => (
              <div key={String(m.id)} className="rounded-lg border border-border p-2 text-xs">
                <div className="flex items-center justify-between mb-0.5">
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-accent text-muted-foreground capitalize">{String(m.memory_type || "memory")}</span>
                  <button type="button" onClick={async () => { if (selectedAgent) { await agentMemoryDelete(selectedAgent.id, String(m.id)); const mem = await agentMemory(selectedAgent.id); setMemories(mem); } }} className="p-0.5 rounded hover:bg-destructive/10 text-destructive"><Trash2 className="w-3 h-3" /></button>
                </div>
                <p className="text-muted-foreground">{String(m.value || "").slice(0, 200)}</p>
                <p className="text-[9px] text-muted-foreground mt-0.5">{m.created_at ? new Date(String(m.created_at)).toLocaleString() : ""}</p>
              </div>
            ))}
          </div>
        )}
      </Modal>

      {/* Collaboration Modal */}
      <Modal open={collabOpen} onClose={() => setCollabOpen(false)} title="Multi-Agent Collaboration" size="lg"
        footer={null}>
        <div className="space-y-3">
          <div className="rounded-lg border border-primary/30 bg-primary/5 p-2 text-xs text-muted-foreground">
            <Sparkles className="w-3 h-3 inline mr-1 text-primary" />
            Select agents to form a collaboration chain. Each agent processes the query and passes its output to the next agent.
          </div>
          <div><label className="block text-xs text-muted-foreground mb-1">Topic</label>
            <input type="text" value={collabTopic} onChange={(e) => setCollabTopic(e.target.value)} placeholder="e.g. Product recommendation for diabetic customer" className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm" />
          </div>
          <div><label className="block text-xs text-muted-foreground mb-1">Query</label>
            <textarea value={collabQuery} onChange={(e) => setCollabQuery(e.target.value)} rows={3} placeholder="Describe the task for the agent chain…" className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm" />
          </div>
          <div>
            <label className="block text-xs text-muted-foreground mb-1">Agent Chain ({collabChain.length} selected)</label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
              {agents.filter((a) => a.is_active).map((a) => (
                <button key={a.id} type="button" onClick={() => toggleAgentInChain(a.id)}
                  className={`flex items-center gap-1.5 p-2 rounded-lg border text-xs ${collabChain.includes(a.id) ? "border-primary bg-primary/5" : "border-border"}`}>
                  <span className="text-base">{a.avatar}</span>
                  <span className="truncate">{a.name}</span>
                  <span className="ml-auto text-[9px] text-muted-foreground">{collabChain.indexOf(a.id) >= 0 ? collabChain.indexOf(a.id) + 1 : ""}</span>
                </button>
              ))}
            </div>
          </div>
          <button type="button" onClick={handleCollaborate} disabled={collabLoading || !collabTopic.trim() || !collabQuery.trim() || collabChain.length === 0} className={`${btnClass.primary} w-full justify-center`}>
            {collabLoading ? <><Loader2 className="w-4 h-4 animate-spin" /> Agents collaborating…</> : <><Zap className="w-4 h-4" /> Start Collaboration</>}
          </button>
          {collabResult ? (
            <div className="space-y-2 mt-2">
              <p className="text-xs font-semibold">Collaboration Result:</p>
              {collabResult.map((msg, i) => (
                <div key={i} className="rounded-lg border border-border p-2 text-xs">
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className="text-base">{String(msg.agent_name || "Agent").charAt(0)}</span>
                    <span className="font-medium">{String(msg.agent_name || "Agent")}</span>
                    <span className="text-[9px] text-muted-foreground">Step {i + 1}</span>
                  </div>
                  <p className="text-muted-foreground whitespace-pre-wrap">{String(msg.message || "")}</p>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </Modal>
    </div>
  );
}
