import { useCallback, useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  FolderOpen, Loader2, ClipboardList, FileText, GraduationCap,
  Briefcase, BookOpen, Package, Send, History, Clock,
} from "lucide-react";
import { AppHeader } from "../common/AppHeader";
import { EmptyState, ErrorState } from "../common/AdminUI";
import {
  listArtifacts, listArtifactVersions, continueArtifact,
  type Artifact, type ArtifactType,
} from "../../../lib/api";

/**
 * Saved Work — Persistent Canvas / Workspace (Capability 30), Interactive
 * Artifacts (31, partial — versioning + checklist type, no per-item check
 * state yet), Persistent Tasks / Task Continuation (32), Answer Change
 * Tracking (37, partial — full version list, no inline diff highlighting).
 *
 * The backend (backend/artifacts_api.py) already fully supported all of
 * this — create/list/versions/continue — but nothing in the frontend ever
 * called `listArtifacts()` or `listArtifactVersions()`; a user could save
 * an answer as an artifact (UserChat.tsx's "Save" action) but never see,
 * reopen, or continue it again. This page closes that gap.
 */

const TYPE_ICONS: Record<ArtifactType, typeof FileText> = {
  action_plan: ClipboardList,
  report: FileText,
  checklist: ClipboardList,
  training_plan: GraduationCap,
  sales_plan: Briefcase,
  summary: FileText,
  business_document: Briefcase,
  guide: BookOpen,
};

const TYPE_LABELS: Record<ArtifactType, string> = {
  action_plan: "Action Plan",
  report: "Report",
  checklist: "Checklist",
  training_plan: "Training Plan",
  sales_plan: "Sales Plan",
  summary: "Summary",
  business_document: "Business Document",
  guide: "Guide",
};

function formatDate(iso?: string): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return iso;
  }
}

function ArtifactCard({ artifact, onClick }: { artifact: Artifact; onClick: () => void }) {
  const Icon = TYPE_ICONS[artifact.artifact_type] ?? Package;
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-left rounded-xl border border-border bg-card p-4 hover:border-primary/40 hover:shadow-sm transition-all"
    >
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
          <Icon className="w-4 h-4" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-sm truncate">{artifact.title}</div>
          <div className="text-[11px] text-muted-foreground mt-0.5">
            {TYPE_LABELS[artifact.artifact_type] ?? artifact.artifact_type} · v{artifact.version}
            {artifact.updated_at ? ` · ${formatDate(artifact.updated_at)}` : ""}
          </div>
          <p className="text-xs text-muted-foreground mt-1.5 line-clamp-2">{artifact.content}</p>
        </div>
      </div>
    </button>
  );
}

function ArtifactDetail({ artifact, onBack, onUpdated }: {
  artifact: Artifact;
  onBack: () => void;
  onUpdated: (updated: Artifact) => void;
}) {
  const [versions, setVersions] = useState<Artifact[]>([]);
  const [versionsLoading, setVersionsLoading] = useState(true);
  const [instruction, setInstruction] = useState("");
  const [continuing, setContinuing] = useState(false);
  const [continueError, setContinueError] = useState<string | null>(null);

  const loadVersions = useCallback(async (id: string) => {
    setVersionsLoading(true);
    try {
      const res = await listArtifactVersions(id);
      setVersions(res.versions);
    } catch {
      setVersions([]);
    } finally {
      setVersionsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadVersions(artifact.id);
  }, [artifact.id, loadVersions]);

  const handleContinue = useCallback(async () => {
    const text = instruction.trim();
    if (!text) return;
    setContinuing(true);
    setContinueError(null);
    try {
      const updated = await continueArtifact(artifact.id, text);
      setInstruction("");
      onUpdated(updated);
      await loadVersions(updated.id);
    } catch (e) {
      setContinueError(e instanceof Error ? e.message : "Couldn't apply that change. Please try again.");
    } finally {
      setContinuing(false);
    }
  }, [artifact.id, instruction, loadVersions, onUpdated]);

  return (
    <div className="max-w-3xl mx-auto w-full">
      <button
        type="button"
        onClick={onBack}
        className="text-xs text-muted-foreground hover:text-foreground mb-3 inline-flex items-center gap-1"
      >
        ← Back to Saved Work
      </button>

      <div className="rounded-xl border border-border bg-card p-4 sm:p-5 mb-4">
        <div className="flex items-center justify-between gap-2 mb-1">
          <h2 className="font-semibold text-base">{artifact.title}</h2>
          <span className="text-[11px] text-muted-foreground shrink-0">
            {TYPE_LABELS[artifact.artifact_type] ?? artifact.artifact_type} · v{artifact.version}
          </span>
        </div>
        <div className="prose prose-sm dark:prose-invert max-w-none mt-3">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{artifact.content}</ReactMarkdown>
        </div>
      </div>

      {/* Task Continuation — AI-assisted edit against this artifact, per the
          brief's "Continue my distributor onboarding plan" example. */}
      <div className="rounded-xl border border-border bg-card p-4 mb-4">
        <p className="text-xs font-semibold mb-2 flex items-center gap-1.5">
          <Send className="w-3.5 h-3.5" aria-hidden="true" /> Continue this
        </p>
        <div className="flex gap-2">
          <input
            type="text"
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !continuing) handleContinue();
            }}
            placeholder="e.g. Make week 2 more aggressive, add a follow-up step…"
            className="flex-1 min-w-0 px-3 py-1.5 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            disabled={continuing}
          />
          <button
            type="button"
            onClick={handleContinue}
            disabled={continuing || !instruction.trim()}
            className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50 inline-flex items-center gap-1.5"
          >
            {continuing ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> : null}
            Apply
          </button>
        </div>
        {continueError ? <p className="text-xs text-destructive mt-2">{continueError}</p> : null}
      </div>

      {/* Answer Change Tracking (Capability 37, partial) — full version
          lineage; each version is a real, never-overwritten row. */}
      <div className="rounded-xl border border-border bg-card p-4">
        <p className="text-xs font-semibold mb-2 flex items-center gap-1.5">
          <History className="w-3.5 h-3.5" aria-hidden="true" /> Version history
        </p>
        {versionsLoading ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> Loading…
          </div>
        ) : (
          <div className="space-y-1.5">
            {versions.map((v) => (
              <div
                key={v.id}
                className={`flex items-center justify-between text-xs px-2.5 py-1.5 rounded-lg ${
                  v.id === artifact.id ? "bg-primary/8 text-primary" : "bg-accent/30 text-muted-foreground"
                }`}
              >
                <span>Version {v.version}{v.id === artifact.id ? " (current)" : ""}</span>
                <span className="inline-flex items-center gap-1">
                  <Clock className="w-3 h-3" aria-hidden="true" />
                  {formatDate(v.created_at)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function SavedWork() {
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Artifact | null>(null);
  const [typeFilter, setTypeFilter] = useState<ArtifactType | "">("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await listArtifacts(typeFilter || undefined);
      setArtifacts(res.artifacts);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load your saved work.");
    } finally {
      setLoading(false);
    }
  }, [typeFilter]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="flex-1 flex flex-col min-w-0 min-h-0">
      <AppHeader
        title="Saved Work"
        subtitle="Action plans, reports, and checklists you've saved from chat — pick up where you left off."
        icon={FolderOpen}
      />
      <div className="flex-1 overflow-y-auto">
        <div className="p-4 sm:p-6 lg:p-8 max-w-6xl mx-auto w-full">
          {selected ? (
            <ArtifactDetail
              artifact={selected}
              onBack={() => setSelected(null)}
              onUpdated={(updated) => {
                setSelected(updated);
                load();
              }}
            />
          ) : (
            <>
              <div className="flex gap-2 mb-4 overflow-x-auto pb-1">
                <button
                  type="button"
                  onClick={() => setTypeFilter("")}
                  className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                    typeFilter === "" ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-accent/50"
                  }`}
                >
                  All
                </button>
                {(Object.keys(TYPE_LABELS) as ArtifactType[]).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setTypeFilter(t)}
                    className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                      typeFilter === t ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-accent/50"
                    }`}
                  >
                    {TYPE_LABELS[t]}
                  </button>
                ))}
              </div>

              {loading ? (
                <div className="flex items-center justify-center py-16 text-muted-foreground">
                  <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" />
                </div>
              ) : error ? (
                <ErrorState message={error} />
              ) : artifacts.length === 0 ? (
                <EmptyState
                  icon={<FolderOpen className="w-8 h-8" aria-hidden="true" />}
                  title="Nothing saved yet"
                  description='Use "Save" on an actionable chat answer (a plan, checklist, or report) to keep it here and continue it later.'
                />
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {artifacts.map((a) => (
                    <ArtifactCard key={a.id} artifact={a} onClick={() => setSelected(a)} />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
