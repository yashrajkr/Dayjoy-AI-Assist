import { useCallback, useEffect, useState } from "react";
import {
  MessageSquare, Loader2, Copy, Check, Trash2, Star, Send,
  Mail, Instagram, Facebook, Calendar, FileText, Sparkles,
} from "lucide-react";
import { LoadingState, ErrorState, EmptyState } from "../common/AdminUI";
import {
  distributorGenerateContent, distributorListContent, distributorDeleteContent,
  distributorToggleContentFavorite, type GeneratedContent,
} from "../../../lib/api";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { Badge } from "../ui/badge";

const CONTENT_TYPES = [
  { value: "whatsapp", label: "WhatsApp", icon: MessageSquare, color: "bg-green-100 text-green-700" },
  { value: "email", label: "Email", icon: Mail, color: "bg-blue-100 text-blue-700" },
  { value: "facebook", label: "Facebook", icon: Facebook, color: "bg-indigo-100 text-indigo-700" },
  { value: "instagram", label: "Instagram", icon: Instagram, color: "bg-pink-100 text-pink-700" },
  { value: "training_invitation", label: "Training Invite", icon: Calendar, color: "bg-orange-100 text-orange-700" },
  { value: "event_announcement", label: "Event", icon: Calendar, color: "bg-purple-100 text-purple-700" },
  { value: "product_description", label: "Product", icon: FileText, color: "bg-teal-100 text-teal-700" },
  { value: "follow_up_message", label: "Follow-up", icon: Send, color: "bg-cyan-100 text-cyan-700" },
  { value: "greeting", label: "Greeting", icon: Sparkles, color: "bg-amber-100 text-amber-700" },
  { value: "festival_promotion", label: "Festival", icon: Sparkles, color: "bg-rose-100 text-rose-700" },
];

const TONES = ["Professional", "Friendly", "Enthusiastic", "Hinglish", "Respectful"];
const LANGUAGES = [{ value: "en", label: "English" }, { value: "hi", label: "Hindi" }];

export function ContentGenerator() {
  const [selectedType, setSelectedType] = useState("whatsapp");
  const [prompt, setPrompt] = useState("");
  const [tone, setTone] = useState("Friendly");
  const [language, setLanguage] = useState("en");
  const [productName, setProductName] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [generating, setGenerating] = useState(false);
  const [generated, setGenerated] = useState("");
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [savedContent, setSavedContent] = useState<GeneratedContent[]>([]);
  const [loadingSaved, setLoadingSaved] = useState(true);
  const [showSaved, setShowSaved] = useState(false);

  const loadSaved = useCallback(async () => {
    setLoadingSaved(true);
    try {
      const data = await distributorListContent({ limit: 50 });
      setSavedContent(data.content);
    } catch { /* ignore */ } finally { setLoadingSaved(false); }
  }, []);

  useEffect(() => { loadSaved(); }, [loadSaved]);

  const generate = async () => {
    if (!prompt.trim()) return;
    setGenerating(true);
    setError(null);
    setGenerated("");
    try {
      const res = await distributorGenerateContent({
        content_type: selectedType,
        prompt: prompt.trim(),
        language,
        tone,
        customer_name: customerName || undefined,
        product_name: productName || undefined,
        save: true,
      });
      setGenerated(res.content);
      await loadSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Generation failed");
    } finally {
      setGenerating(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const toggleFav = async (c: GeneratedContent) => {
    if (!c.id) return;
    try {
      await distributorToggleContentFavorite(c.id);
      await loadSaved();
    } catch { /* ignore */ }
  };

  const handleDelete = async (c: GeneratedContent) => {
    if (!c.id || !window.confirm("Delete this content?")) return;
    try { await distributorDeleteContent(c.id); await loadSaved(); } catch { /* ignore */ }
  };

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto">
      <div className="mb-4">
        <h1 className="text-xl sm:text-2xl font-semibold flex items-center gap-2"><Sparkles className="w-5 h-5 text-primary" /> Content Generator</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Generate WhatsApp messages, emails, social posts, and more.</p>
      </div>

      {error ? <ErrorState message={error} /> : null}

      {/* Content type grid */}
      <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 mb-4">
        {CONTENT_TYPES.map((t) => (
          <button key={t.value} type="button" onClick={() => setSelectedType(t.value)}
            className={`flex flex-col items-center gap-1 p-2 rounded-xl border transition-all ${selectedType === t.value ? "border-primary bg-primary/5" : "border-border bg-card hover:bg-accent/40"}`}>
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${t.color}`}><t.icon className="w-4 h-4" /></div>
            <span className="text-[10px] font-medium text-center">{t.label}</span>
          </button>
        ))}
      </div>

      {/* Options */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-3">
        <select value={tone} onChange={(e) => setTone(e.target.value)} className="px-3 py-2 rounded-lg border border-border bg-card text-sm">
          {TONES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={language} onChange={(e) => setLanguage(e.target.value)} className="px-3 py-2 rounded-lg border border-border bg-card text-sm">
          {LANGUAGES.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
        </select>
        <input type="text" value={productName} onChange={(e) => setProductName(e.target.value)} placeholder="Product name (optional)"
          className="px-3 py-2 rounded-lg border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" />
      </div>
      <input type="text" value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="Customer name (optional)"
        className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 mb-3" />

      {/* Prompt */}
      <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={3}
        placeholder="Describe what you want to generate… (e.g. 'Follow-up message for a customer who asked about Ashwagandha last week')"
        className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 mb-3" />

      <Button type="button" onClick={generate} disabled={generating || !prompt.trim()} className="w-full justify-center">
        {generating ? <><Loader2 className="w-4 h-4 animate-spin" /> Generating…</> : <><Sparkles className="w-4 h-4" /> Generate</>}
      </Button>

      {/* Generated content */}
      {generated ? (
        <Card className="mt-4 border-primary/30 bg-primary/5 p-4 shadow-none">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-primary">Generated Content</h3>
            <Button type="button" variant="outline" size="sm" onClick={() => copyToClipboard(generated)} className="text-xs h-auto py-1">
              {copied ? <><Check className="w-3 h-3" /> Copied</> : <><Copy className="w-3 h-3" /> Copy</>}
            </Button>
          </div>
          <pre className="whitespace-pre-wrap text-sm font-sans">{generated}</pre>
        </Card>
      ) : null}

      {/* Saved content toggle */}
      <div className="mt-6">
        <button type="button" onClick={() => setShowSaved(!showSaved)} className="text-sm font-medium text-primary hover:underline flex items-center gap-1">
          <FileText className="w-4 h-4" /> Saved Content ({savedContent.length})
        </button>
        {showSaved ? (
          loadingSaved ? <LoadingState /> : savedContent.length === 0 ? (
            <Card className="mt-2 p-4 shadow-none"><EmptyState title="No saved content" icon={<FileText className="w-5 h-5" />} /></Card>
          ) : (
            <div className="mt-2 space-y-2">
              {savedContent.map((c) => (
                <Card key={c.id} className="p-3 shadow-none">
                  <div className="flex items-center justify-between mb-1">
                    <Badge variant="secondary" className="uppercase">{c.content_type.replace(/_/g, " ")}</Badge>
                    <div className="flex gap-0.5">
                      <Button type="button" variant="ghost" size="icon" className="h-auto w-auto p-1" onClick={() => toggleFav(c)} title="Favorite">
                        <Star className={`w-3.5 h-3.5 ${c.is_favorite ? "fill-amber-400 text-amber-400" : "text-muted-foreground"}`} />
                      </Button>
                      <Button type="button" variant="ghost" size="icon" className="h-auto w-auto p-1" onClick={() => copyToClipboard(c.content)} title="Copy"><Copy className="w-3.5 h-3.5 text-muted-foreground" /></Button>
                      <Button type="button" variant="ghost" size="icon" className="h-auto w-auto p-1 text-destructive hover:bg-destructive/10" onClick={() => handleDelete(c)} title="Delete"><Trash2 className="w-3.5 h-3.5" /></Button>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground line-clamp-2">{c.content}</p>
                  <p className="text-[10px] text-muted-foreground mt-1">{c.created_at ? new Date(c.created_at).toLocaleString() : ""}</p>
                </Card>
              ))}
            </div>
          )
        ) : null}
      </div>
    </div>
  );
}
