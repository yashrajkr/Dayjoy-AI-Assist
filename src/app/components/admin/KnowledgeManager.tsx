import { useCallback, useEffect, useState } from "react";
import {
  Database,
  RefreshCw,
  Upload,
  FileText,
  Trash2,
  Download,
  Eye,
  Search,
  Filter,
  Check,
  X,
  Archive,
  RotateCw,
  History,
  Loader2,
  Tag,
  FileWarning,
} from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import { useAuth } from "../../lib/AuthContext";
import {
  PageHeader,
  Card,
  StatusPill,
  EmptyState,
  LoadingState,
  ErrorState,
  StatCard,
} from "../common/AdminUI";
import { Modal } from "../common/Modal";
import { Button } from "../ui/button";
import {
  ragListDocuments,
  ragUploadDocument,
  ragUpdateApproval,
  ragDeleteDocument,
  ragReindexDocument,
  ragReplaceDocument,
  ragGetDocument,
  ragHealth,
  adminKnowledgeFreshness,
  type RAGDocument,
  type KnowledgeFreshnessReport,
} from "../../../lib/api";

const STORAGE_BUCKET = "knowledge-documents";

const CATEGORIES = [
  { value: "other", label: "Other" },
  { value: "product", label: "Product" },
  { value: "training", label: "Training" },
  { value: "policy", label: "Policy" },
  { value: "faq", label: "FAQ" },
  { value: "marketing", label: "Marketing" },
  { value: "technical", label: "Technical" },
];

const APPROVAL_FILTERS = [
  { value: "", label: "All statuses" },
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "archived", label: "Archived" },
];

type Chunk = {
  id: string;
  chunk_text: string;
  section_title: string | null;
  page_number: number | null;
  chunk_order: number | null;
  token_count: number | null;
  created_at: string | null;
};

type DocVersion = {
  id: string;
  version_number: number;
  file_url: string | null;
  file_size_bytes: number | null;
  change_summary: string | null;
  created_at: string | null;
};

/** Knowledge Freshness Monitoring (Capability 42) — a self-contained,
 * collapsible panel showing stale/duplicate/incomplete-metadata documents
 * flagged by GET /admin/analytics/knowledge-freshness. Deliberately
 * independent of the document list state above it (own loading/error
 * state, own fetch) so it degrades gracefully on its own if that endpoint
 * is slow/unavailable, without affecting the rest of the page. */
function FreshnessAlerts() {
  const [report, setReport] = useState<KnowledgeFreshnessReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    adminKnowledgeFreshness()
      .then((r) => {
        if (!cancelled) setReport(r);
      })
      .catch(() => {
        if (!cancelled) setReport(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading || !report) return null;
  const totalIssues =
    report.stale_documents.length + report.missing_metadata_documents.length + report.duplicate_documents.length;
  if (totalIssues === 0) return null;

  return (
    <div className="mb-6 rounded-xl border border-warning/30 bg-warning/5 overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between gap-2 p-3 text-left hover:bg-warning/10 transition-colors"
      >
        <div className="flex items-center gap-2">
          <FileWarning className="w-4 h-4 text-warning shrink-0" aria-hidden="true" />
          <span className="text-sm font-medium">
            {totalIssues} knowledge freshness issue{totalIssues === 1 ? "" : "s"} found
          </span>
        </div>
        <span className="text-xs text-muted-foreground">{expanded ? "Hide" : "Show"}</span>
      </button>
      {expanded ? (
        <div className="border-t border-warning/20 p-3 space-y-3 text-sm">
          {report.stale_documents.length > 0 ? (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                Stale (approved, not updated in {report.stale_after_days}+ days)
              </p>
              <ul className="space-y-1">
                {report.stale_documents.slice(0, 10).map((d) => (
                  <li key={d.id} className="flex items-center justify-between">
                    <span className="truncate">{d.file_name}</span>
                    <span className="text-xs text-muted-foreground shrink-0 ml-2">{d.days_since_update} days ago</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {report.duplicate_documents.length > 0 ? (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                Possible duplicates (same file name)
              </p>
              <ul className="space-y-1">
                {report.duplicate_documents.slice(0, 10).map((d) => (
                  <li key={d.file_name} className="flex items-center justify-between">
                    <span className="truncate">{d.file_name}</span>
                    <span className="text-xs text-muted-foreground shrink-0 ml-2">{d.count} copies</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {report.missing_metadata_documents.length > 0 ? (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                Missing category/tags
              </p>
              <ul className="space-y-1">
                {report.missing_metadata_documents.slice(0, 10).map((d) => (
                  <li key={d.id} className="truncate">{d.file_name}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function KnowledgeManager() {
  const { currentUser } = useAuth();
  const [docs, setDocs] = useState<RAGDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [detailDoc, setDetailDoc] = useState<RAGDocument | null>(null);
  const [detailChunks, setDetailChunks] = useState<Chunk[]>([]);
  const [detailVersions, setDetailVersions] = useState<DocVersion[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadName, setUploadName] = useState("");
  const [uploadCategory, setUploadCategory] = useState("other");
  const [uploadLanguage, setUploadLanguage] = useState("en");
  const [uploadTags, setUploadTags] = useState("");
  const [uploadApproval, setUploadApproval] = useState("pending");
  const [uploadFile, setUploadFile] = useState<File | null>(null);

  // Filters
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const limit = 50;

  // Health
  const [ragAvailable, setRagAvailable] = useState<boolean | null>(null);

  // Replace modal
  const [replaceDoc, setReplaceDoc] = useState<RAGDocument | null>(null);
  const [replaceFile, setReplaceFile] = useState<File | null>(null);
  const [replaceSummary, setReplaceSummary] = useState("");
  const [replacing, setReplacing] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await ragListDocuments({
        limit,
        offset,
        category: categoryFilter || undefined,
        approval_status: statusFilter || undefined,
        search: search || undefined,
      });
      setDocs(data.documents);
      setTotal(data.total);
    } catch {
      // Fallback to direct Supabase query (legacy path)
      if (!supabase) {
        setError("Supabase is not configured.");
        setLoading(false);
        return;
      }
      try {
        let query = supabase
          .from("knowledge_documents")
          .select("*")
          .order("created_at", { ascending: false })
          .range(offset, offset + limit - 1);
        if (statusFilter) query = query.eq("approval_status", statusFilter);
        if (categoryFilter) query = query.eq("category", categoryFilter);
        if (search) query = query.ilike("file_name", `%${search}%`);
        const { data: rows, error: err } = await query;
        if (err) throw err;
        setDocs((rows ?? []) as unknown as RAGDocument[]);
        setTotal(rows?.length ?? 0);
      } catch (e2) {
        setError(e2 instanceof Error ? e2.message : "Failed to load documents");
      }
    } finally {
      setLoading(false);
    }
  }, [offset, categoryFilter, statusFilter, search]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Health check on mount
  useEffect(() => {
    ragHealth()
      .then((h) => setRagAvailable(h?.rag_available ?? false))
      .catch(() => setRagAvailable(false));
  }, []);

  const openDetail = async (doc: RAGDocument) => {
    setDetailDoc(doc);
    setDetailChunks([]);
    setDetailVersions([]);
    setDetailLoading(true);
    try {
      const data = await ragGetDocument(doc.id);
      setDetailChunks((data.chunks as unknown as Chunk[]) ?? []);
      setDetailVersions((data.versions as unknown as DocVersion[]) ?? []);
    } catch {
      // Fallback: load chunks via direct Supabase
      if (supabase) {
        const { data: chunks } = await supabase
          .from("knowledge_chunks")
          .select("id,chunk_text,section_title,page_number,chunk_order,token_count,created_at")
          .eq("document_id", doc.id)
          .order("chunk_order", { ascending: true })
          .limit(50);
        setDetailChunks((chunks as unknown as Chunk[]) ?? []);
      }
    } finally {
      setDetailLoading(false);
    }
  };

  const handleUpload = async () => {
    if (!uploadFile) {
      setError("Choose a file first.");
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const result = await ragUploadDocument({
        file: uploadFile,
        category: uploadCategory,
        language: uploadLanguage,
        tags: uploadTags,
        document_name: uploadName || uploadFile.name,
        approval_status: uploadApproval,
      });
      if (result.error) {
        setError(`Ingest completed with errors: ${result.error}`);
      }
      setUploadOpen(false);
      setUploadFile(null);
      setUploadName("");
      setUploadTags("");
      await refresh();
    } catch (e) {
      // Fallback to legacy direct-upload path
      if (!supabase || !currentUser?.id) {
        setError(e instanceof Error ? e.message : "Upload failed");
        setUploading(false);
        return;
      }
      try {
        const path = `${Date.now()}-${uploadFile.name.replace(/[^a-zA-Z0-9.\-_]/g, "_")}`;
        const { error: upErr } = await supabase.storage
          .from(STORAGE_BUCKET)
          .upload(path, uploadFile, { contentType: uploadFile.type || "application/octet-stream" });
        if (upErr) throw upErr;
        const { data: pub } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path);
        const { error: insErr } = await supabase.from("knowledge_documents").insert({
          document_id: path,
          file_name: uploadName || uploadFile.name,
          file_type: uploadFile.name.split(".").pop() ?? "bin",
          file_url: pub.publicUrl,
          extracted_text: "",
          approval_status: uploadApproval,
          uploaded_by: currentUser.id,
          category: uploadCategory,
          tags: uploadTags.split(",").map((t) => t.trim()).filter(Boolean),
          language: uploadLanguage,
        });
        if (insErr) throw insErr;
        setUploadOpen(false);
        setUploadFile(null);
        setUploadName("");
        setUploadTags("");
        await refresh();
      } catch (e2) {
        setError(e2 instanceof Error ? e2.message : "Upload failed");
      }
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (doc: RAGDocument) => {
    if (!window.confirm(`Archive ${doc.file_name}? (Use hard-delete to permanently remove.)`)) return;
    try {
      await ragDeleteDocument(doc.id, true);
      setDocs((prev) => prev.filter((d) => d.id !== doc.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    }
  };

  const handleHardDelete = async (doc: RAGDocument) => {
    if (!window.confirm(`PERMANENTLY DELETE ${doc.file_name}? This cannot be undone.`)) return;
    try {
      await ragDeleteDocument(doc.id, false);
      setDocs((prev) => prev.filter((d) => d.id !== doc.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    }
  };

  const handleApprove = async (doc: RAGDocument, status: "approved" | "rejected") => {
    try {
      await ragUpdateApproval(doc.id, status);
      setDocs((prev) => prev.map((d) => (d.id === doc.id ? { ...d, approval_status: status } : d)));
    } catch (e) {
      // Fallback to direct Supabase update
      if (supabase) {
        try {
          await supabase.from("knowledge_documents").update({ approval_status: status }).eq("id", doc.id);
          setDocs((prev) => prev.map((d) => (d.id === doc.id ? { ...d, approval_status: status } : d)));
        } catch (e2) {
          setError(e2 instanceof Error ? e2.message : "Update failed");
        }
      } else {
        setError(e instanceof Error ? e.message : "Update failed");
      }
    }
  };

  const handleReindex = async (doc: RAGDocument) => {
    if (!window.confirm(`Re-chunk and re-embed ${doc.file_name}? This will replace existing chunks.`)) return;
    try {
      await ragReindexDocument(doc.id);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Reindex failed");
    }
  };

  const handleReplaceSubmit = async () => {
    if (!replaceDoc || !replaceFile) {
      setError("Choose a replacement file first.");
      return;
    }
    setReplacing(true);
    setError(null);
    try {
      await ragReplaceDocument(replaceDoc.id, replaceFile, replaceSummary);
      setReplaceDoc(null);
      setReplaceFile(null);
      setReplaceSummary("");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Replace failed");
    } finally {
      setReplacing(false);
    }
  };

  const counts = docs.reduce<Record<string, number>>((acc, d) => {
    acc[d.approval_status ?? "unknown"] = (acc[d.approval_status ?? "unknown"] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto">
      <PageHeader
        title="Knowledge Base (RAG)"
        description="Upload, approve, chunk, and embed documents used by the AI assistant for grounded answers."
        icon={<Database className="w-5 h-5" />}
        actions={
          <>
            <Button type="button" variant="secondary" onClick={refresh}>
              <RefreshCw className="w-4 h-4" aria-hidden="true" /> Refresh
            </Button>
            <Button
              type="button"
              onClick={() => setUploadOpen(true)}
              disabled={ragAvailable === false}
            >
              <Upload className="w-4 h-4" aria-hidden="true" /> Upload document
            </Button>
          </>
        }
      />

      {/* RAG subsystem status banner */}
      {ragAvailable === false ? (
        <div className="mb-4 rounded-xl border border-warning/30 bg-warning/10 p-3 flex items-start gap-2">
          <FileWarning className="w-4 h-4 mt-0.5 text-warning shrink-0" aria-hidden="true" />
          <div className="text-sm">
            <div className="font-medium">RAG backend not available</div>
            <p className="text-xs text-muted-foreground mt-0.5">
              The FastAPI <code>/rag/*</code> endpoints are not reachable. Document uploads will fall back
              to direct Supabase storage without chunking or embeddings. Start the backend and install
              RAG dependencies (pypdf, python-docx, openpyxl, python-pptx) to enable full RAG.
            </p>
          </div>
        </div>
      ) : null}

      <FreshnessAlerts />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <StatCard label="Approved" value={counts["approved"] ?? 0} />
        <StatCard label="Pending" value={counts["pending"] ?? 0} />
        <StatCard label="Rejected" value={counts["rejected"] ?? 0} />
        <StatCard label="Archived" value={counts["archived"] ?? 0} />
      </div>

      {/* Filters */}
      <Card className="mb-4">
        <div className="p-3 flex flex-col sm:flex-row gap-2">
          <div className="flex-1 relative">
            <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-muted-foreground" aria-hidden="true" />
            <input
              type="text"
              placeholder="Search by file name..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setOffset(0);
              }}
              className="w-full pl-8 pr-3 py-2 rounded-lg border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
          </div>
          <select
            value={categoryFilter}
            onChange={(e) => {
              setCategoryFilter(e.target.value);
              setOffset(0);
            }}
            className="px-3 py-2 rounded-lg border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            aria-label="Filter by category"
          >
            <option value="">All categories</option>
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setOffset(0);
            }}
            className="px-3 py-2 rounded-lg border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            aria-label="Filter by approval status"
          >
            {APPROVAL_FILTERS.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              setSearch("");
              setCategoryFilter("");
              setStatusFilter("");
              setOffset(0);
            }}
          >
            <Filter className="w-4 h-4" aria-hidden="true" /> Clear
          </Button>
        </div>
      </Card>

      {error ? <div className="mb-4"><ErrorState message={error} /></div> : null}

      {loading ? (
        <LoadingState label="Loading documents…" />
      ) : docs.length === 0 ? (
        <Card>
          <EmptyState
            title="No documents yet"
            description="Upload PDFs, DOCX, TXT, CSV, Markdown, PPTX, or XLSX files to seed the AI knowledge base. Each upload is chunked and embedded automatically."
            icon={<FileText className="w-5 h-5" />}
          />
        </Card>
      ) : (
        <Card className="p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-3 font-medium">File</th>
                  <th className="px-4 py-3 font-medium">Category</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium hidden md:table-cell">Chunks</th>
                  <th className="px-4 py-3 font-medium hidden sm:table-cell">Version</th>
                  <th className="px-4 py-3 font-medium hidden lg:table-cell">Uploaded</th>
                  <th className="px-4 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {docs.map((d) => (
                  <tr key={d.id} className="border-b border-border last:border-0 hover:bg-accent/30">
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => openDetail(d)}
                        className="text-left hover:text-primary transition-colors"
                      >
                        <div className="font-medium truncate max-w-xs">{d.file_name || "Untitled"}</div>
                        <div className="text-xs text-muted-foreground font-mono truncate max-w-xs">
                          {(d.document_id || d.id).slice(0, 24)}
                        </div>
                      </button>
                      {d.tags && d.tags.length > 0 ? (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {d.tags.slice(0, 3).map((t) => (
                            <span
                              key={t}
                              className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full bg-accent text-muted-foreground"
                            >
                              <Tag className="w-2.5 h-2.5" aria-hidden="true" /> {t}
                            </span>
                          ))}
                          {d.tags.length > 3 ? <span className="text-[10px] text-muted-foreground">+{d.tags.length - 3}</span> : null}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground text-xs uppercase">
                      {d.category || "—"}
                    </td>
                    <td className="px-4 py-3">
                      <StatusPill status={d.approval_status ?? "pending"} />
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell text-muted-foreground text-xs">
                      {d.chunk_count ?? 0} chunks
                      <div className="text-[10px]">{d.token_count ?? 0} tokens</div>
                    </td>
                    <td className="px-4 py-3 hidden sm:table-cell text-muted-foreground text-xs">
                      v{d.version ?? 1}
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell text-muted-foreground text-xs">
                      {d.created_at ? new Date(d.created_at).toLocaleDateString() : "—"}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          className="p-1.5 rounded-lg hover:bg-accent/60"
                          aria-label={`Preview ${d.file_name ?? "document"}`}
                          title="Preview & chunks"
                          onClick={() => openDetail(d)}
                        >
                          <Eye className="w-3.5 h-3.5" aria-hidden="true" />
                        </button>
                        {d.file_url ? (
                          <a
                            href={d.file_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="p-1.5 rounded-lg hover:bg-accent/60"
                            aria-label={`Download ${d.file_name ?? "document"}`}
                            title="Download"
                          >
                            <Download className="w-3.5 h-3.5" aria-hidden="true" />
                          </a>
                        ) : null}
                        <button
                          type="button"
                          className="p-1.5 rounded-lg hover:bg-accent/60"
                          aria-label={`Re-index ${d.file_name ?? "document"}`}
                          title="Re-chunk & re-embed"
                          onClick={() => handleReindex(d)}
                        >
                          <RotateCw className="w-3.5 h-3.5" aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          className="p-1.5 rounded-lg hover:bg-accent/60"
                          aria-label={`Replace ${d.file_name ?? "document"}`}
                          title="Upload new version"
                          onClick={() => setReplaceDoc(d)}
                        >
                          <History className="w-3.5 h-3.5" aria-hidden="true" />
                        </button>
                        {d.approval_status === "pending" ? (
                          <>
                            <Button
                              type="button"
                              size="sm"
                              onClick={() => handleApprove(d, "approved")}
                            >
                              <Check className="w-3 h-3" aria-hidden="true" /> Approve
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="text-destructive border-destructive hover:bg-destructive/10"
                              onClick={() => handleApprove(d, "rejected")}
                            >
                              <X className="w-3 h-3" aria-hidden="true" /> Reject
                            </Button>
                          </>
                        ) : null}
                        <button
                          type="button"
                          className="p-1.5 rounded-lg hover:bg-warning/10 text-warning"
                          aria-label={`Archive ${d.file_name ?? "document"}`}
                          title="Archive"
                          onClick={() => handleDelete(d)}
                        >
                          <Archive className="w-3.5 h-3.5" aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          className="p-1.5 rounded-lg hover:bg-destructive/10 text-destructive"
                          aria-label={`Permanently delete ${d.file_name ?? "document"}`}
                          title="Hard delete"
                          onClick={() => handleHardDelete(d)}
                        >
                          <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* Pagination */}
          {total > limit ? (
            <div className="px-4 py-3 border-t border-border flex items-center justify-between text-xs text-muted-foreground">
              <span>
                Showing {offset + 1}–{Math.min(offset + limit, total)} of {total}
              </span>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  disabled={offset === 0}
                  onClick={() => setOffset(Math.max(0, offset - limit))}
                >
                  Previous
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={offset + limit >= total}
                  onClick={() => setOffset(offset + limit)}
                >
                  Next
                </Button>
              </div>
            </div>
          ) : null}
        </Card>
      )}

      {/* Upload modal */}
      <Modal
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        title="Upload knowledge document"
        description="Supported: PDF, DOCX, TXT, CSV, Markdown, PPTX, XLSX. The file will be chunked and embedded automatically."
        size="md"
        footer={
          <>
            <Button type="button" variant="secondary" onClick={() => setUploadOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleUpload}
              disabled={uploading || !uploadFile}
            >
              {uploading ? <><Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> Uploading…</> : "Upload & ingest"}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div>
            <label htmlFor="dj-doc-name" className="block text-xs font-medium text-muted-foreground mb-1">
              Display name
            </label>
            <input
              id="dj-doc-name"
              value={uploadName}
              onChange={(e) => setUploadName(e.target.value)}
              placeholder="e.g. Q3 Wellness Catalogue"
              className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="dj-doc-cat" className="block text-xs font-medium text-muted-foreground mb-1">
                Category
              </label>
              <select
                id="dj-doc-cat"
                value={uploadCategory}
                onChange={(e) => setUploadCategory(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
              >
                {CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="dj-doc-lang" className="block text-xs font-medium text-muted-foreground mb-1">
                Language
              </label>
              <select
                id="dj-doc-lang"
                value={uploadLanguage}
                onChange={(e) => setUploadLanguage(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
              >
                <option value="en">English</option>
                <option value="hi">Hindi</option>
                <option value="ta">Tamil</option>
                <option value="te">Telugu</option>
                <option value="kn">Kannada</option>
                <option value="mr">Marathi</option>
                <option value="bn">Bengali</option>
              </select>
            </div>
          </div>
          <div>
            <label htmlFor="dj-doc-tags" className="block text-xs font-medium text-muted-foreground mb-1">
              Tags (comma-separated)
            </label>
            <input
              id="dj-doc-tags"
              value={uploadTags}
              onChange={(e) => setUploadTags(e.target.value)}
              placeholder="wellness, distributor, q3"
              className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
          </div>
          <div>
            <label htmlFor="dj-doc-approval" className="block text-xs font-medium text-muted-foreground mb-1">
              Initial approval status
            </label>
            <select
              id="dj-doc-approval"
              value={uploadApproval}
              onChange={(e) => setUploadApproval(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            >
              <option value="pending">Pending review (default)</option>
              <option value="approved">Approved (immediately searchable)</option>
              <option value="rejected">Rejected</option>
            </select>
          </div>
          <div>
            <label htmlFor="dj-doc-file" className="block text-xs font-medium text-muted-foreground mb-1">
              File
            </label>
            <input
              id="dj-doc-file"
              type="file"
              onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)}
              className="w-full text-sm"
              accept=".pdf,.docx,.doc,.txt,.md,.markdown,.csv,.json,.pptx,.ppt,.xlsx,.xls,application/pdf,text/plain,text/markdown,text/csv,application/json"
            />
            {uploadFile ? (
              <p className="mt-1 text-xs text-muted-foreground">
                {uploadFile.name} — {(uploadFile.size / 1024).toFixed(1)} KB
              </p>
            ) : null}
          </div>
        </div>
      </Modal>

      {/* Document detail / chunks modal */}
      <Modal
        open={!!detailDoc}
        onClose={() => setDetailDoc(null)}
        title={detailDoc?.file_name ?? "Document"}
        description={detailDoc ? `${detailDoc.file_type?.toUpperCase() ?? "FILE"} • v${detailDoc.version ?? 1} • ${detailDoc.chunk_count ?? 0} chunks` : ""}
        size="lg"
      >
        {detailDoc ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
              <div className="rounded-lg bg-accent/30 p-2">
                <div className="text-muted-foreground">Status</div>
                <div className="font-medium">{detailDoc.approval_status ?? "—"}</div>
              </div>
              <div className="rounded-lg bg-accent/30 p-2">
                <div className="text-muted-foreground">Category</div>
                <div className="font-medium">{detailDoc.category ?? "—"}</div>
              </div>
              <div className="rounded-lg bg-accent/30 p-2">
                <div className="text-muted-foreground">Language</div>
                <div className="font-medium">{detailDoc.language ?? "—"}</div>
              </div>
              <div className="rounded-lg bg-accent/30 p-2">
                <div className="text-muted-foreground">Tokens</div>
                <div className="font-medium">{detailDoc.token_count ?? 0}</div>
              </div>
            </div>
            {detailDoc.tags && detailDoc.tags.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {detailDoc.tags.map((t) => (
                  <span key={t} className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full bg-accent text-muted-foreground">
                    <Tag className="w-2.5 h-2.5" aria-hidden="true" /> {t}
                  </span>
                ))}
              </div>
            ) : null}
            {detailDoc.file_url ? (
              <Button asChild>
                <a
                  href={detailDoc.file_url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Download className="w-4 h-4" aria-hidden="true" /> Open original file
                </a>
              </Button>
            ) : null}

            {/* Version history */}
            {detailVersions.length > 0 ? (
              <div>
                <h4 className="text-xs uppercase tracking-wide text-muted-foreground mb-1.5">Version history</h4>
                <div className="space-y-1">
                  {detailVersions.map((v) => (
                    <div key={v.id} className="flex items-center justify-between text-xs border border-border rounded-lg px-2 py-1.5">
                      <span className="font-medium">v{v.version_number}</span>
                      <span className="text-muted-foreground truncate max-w-[60%]">{v.change_summary ?? "—"}</span>
                      <span className="text-muted-foreground">
                        {v.created_at ? new Date(v.created_at).toLocaleDateString() : "—"}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {/* Chunks */}
            <div>
              <h4 className="text-xs uppercase tracking-wide text-muted-foreground mb-1.5">
                Chunks ({detailChunks.length}{detailDoc.chunk_count && detailDoc.chunk_count > detailChunks.length ? ` of ${detailDoc.chunk_count}` : ""})
              </h4>
              {detailLoading ? (
                <div className="text-sm text-muted-foreground">Loading chunks…</div>
              ) : detailChunks.length === 0 ? (
                <div className="text-sm text-muted-foreground">
                  No chunks yet. Click the re-index button to chunk this document.
                </div>
              ) : (
                <div className="max-h-96 overflow-y-auto space-y-2">
                  {detailChunks.map((c, i) => (
                    <div key={c.id} className="border border-border rounded-lg p-2 text-xs">
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-mono text-[10px] text-muted-foreground">#{c.chunk_order ?? i + 1}</span>
                        <span className="text-[10px] text-muted-foreground">
                          {c.section_title ?? "—"} • p.{c.page_number ?? "?"} • {c.token_count ?? 0} tok
                        </span>
                      </div>
                      <p className="text-foreground line-clamp-3 whitespace-pre-wrap">{c.chunk_text}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : null}
      </Modal>

      {/* Replace modal */}
      <Modal
        open={!!replaceDoc}
        onClose={() => {
          setReplaceDoc(null);
          setReplaceFile(null);
          setReplaceSummary("");
        }}
        title={`Replace: ${replaceDoc?.file_name ?? ""}`}
        description="Upload a new version. The old document will be archived. The new version inherits category, tags, and language, but requires re-approval."
        size="md"
        footer={
          <>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setReplaceDoc(null);
                setReplaceFile(null);
                setReplaceSummary("");
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleReplaceSubmit}
              disabled={replacing || !replaceFile}
            >
              {replacing ? <><Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> Replacing…</> : "Upload new version"}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div>
            <label htmlFor="dj-replace-file" className="block text-xs font-medium text-muted-foreground mb-1">
              New version file
            </label>
            <input
              id="dj-replace-file"
              type="file"
              onChange={(e) => setReplaceFile(e.target.files?.[0] ?? null)}
              className="w-full text-sm"
              accept=".pdf,.docx,.doc,.txt,.md,.markdown,.csv,.json,.pptx,.ppt,.xlsx,.xls"
            />
            {replaceFile ? (
              <p className="mt-1 text-xs text-muted-foreground">
                {replaceFile.name} — {(replaceFile.size / 1024).toFixed(1)} KB
              </p>
            ) : null}
          </div>
          <div>
            <label htmlFor="dj-replace-summary" className="block text-xs font-medium text-muted-foreground mb-1">
              Change summary (optional)
            </label>
            <textarea
              id="dj-replace-summary"
              value={replaceSummary}
              onChange={(e) => setReplaceSummary(e.target.value)}
              placeholder="e.g. Updated pricing for Q4 2026"
              rows={3}
              className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
          </div>
        </div>
      </Modal>
    </div>
  );
}
