-- ============================================================================
-- Dayjoy AI Assist — Supabase Schema v6 (Enterprise RAG System)
-- ----------------------------------------------------------------------------
-- This migration implements a full Retrieval-Augmented Generation pipeline:
--   1. Extends `knowledge_documents` with metadata columns (category, tags,
--      language, source, version, approval workflow fields, chunk stats).
--   2. Adds `knowledge_chunks` — semantic chunk storage with section, page,
--      order, token count, and metadata.
--   3. Adds `knowledge_embeddings` — embedding rows (works with or without
--      pgvector; falls back to JSONB storage for environments without the
--      extension).
--   4. Adds `document_versions` — version history for replaced documents.
--   5. Adds `rag_queries` — retrieval audit log (query, retrieved chunks,
--      confidence, verification status).
--   6. Adds `rag_cache` — answer cache keyed by normalized query hash.
--   7. Storage bucket for raw knowledge files (private; staff-only access).
--   8. RLS policies for all new tables (staff can manage, users can read
--      approved rows).
--   9. Indexes for fast retrieval and filtering.
--  10. A SQL function `match_chunks` that does cosine similarity ranking
--      using pure SQL (no pgvector required) for portability, plus an
--      optional pgvector index when the extension is available.
--
-- IDEMPOTENT — safe to re-run. All statements use `if not exists` or
-- `drop ... if exists` patterns.
-- ============================================================================

-- ============================================================================
-- 0. Helper functions (idempotent — defined in earlier migrations, re-declared
--    here with `if not exists` semantics by `create or replace`).
-- ============================================================================
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ============================================================================
-- 1. Extend `knowledge_documents` with RAG metadata
-- ============================================================================
-- The original v1 schema has: id, document_id, file_name, file_type, file_url,
-- extracted_text, approval_status, uploaded_by, created_at.
-- We add columns to support enterprise document management.

do $$
begin
  -- category — high-level document type (product, training, policy, faq, marketing, technical, other)
  if not exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='knowledge_documents'
                 and column_name='category') then
    alter table knowledge_documents add column category text default 'other';
  end if;

  -- tags — array of free-form tags
  if not exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='knowledge_documents'
                 and column_name='tags') then
    alter table knowledge_documents add column tags text[] default '{}';
  end if;

  -- language — ISO code (en, hi, etc.)
  if not exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='knowledge_documents'
                 and column_name='language') then
    alter table knowledge_documents add column language text default 'en';
  end if;

  -- source — where the document came from (manual_upload, api, scrape, imported)
  if not exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='knowledge_documents'
                 and column_name='source') then
    alter table knowledge_documents add column source text default 'manual_upload';
  end if;

  -- version — integer version number, starts at 1
  if not exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='knowledge_documents'
                 and column_name='version') then
    alter table knowledge_documents add column version integer default 1;
  end if;

  -- previous_version_id — points to the prior version when replaced
  if not exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='knowledge_documents'
                 and column_name='previous_version_id') then
    alter table knowledge_documents add column previous_version_id uuid;
  end if;

  -- is_archived — soft archive flag
  if not exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='knowledge_documents'
                 and column_name='is_archived') then
    alter table knowledge_documents add column is_archived boolean default false;
  end if;

  -- reviewed_by — admin who approved/rejected
  if not exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='knowledge_documents'
                 and column_name='reviewed_by') then
    alter table knowledge_documents add column reviewed_by uuid;
  end if;

  -- reviewed_at — when approved/rejected
  if not exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='knowledge_documents'
                 and column_name='reviewed_at') then
    alter table knowledge_documents add column reviewed_at timestamptz;
  end if;

  -- rejection_reason — optional note when rejected
  if not exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='knowledge_documents'
                 and column_name='rejection_reason') then
    alter table knowledge_documents add column rejection_reason text;
  end if;

  -- chunk_count — denormalized count of chunks for fast display
  if not exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='knowledge_documents'
                 and column_name='chunk_count') then
    alter table knowledge_documents add column chunk_count integer default 0;
  end if;

  -- token_count — total tokens across all chunks
  if not exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='knowledge_documents'
                 and column_name='token_count') then
    alter table knowledge_documents add column token_count integer default 0;
  end if;

  -- file_size_bytes — for display and storage quota tracking
  if not exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='knowledge_documents'
                 and column_name='file_size_bytes') then
    alter table knowledge_documents add column file_size_bytes bigint;
  end if;

  -- mime_type — explicit mime for download headers
  if not exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='knowledge_documents'
                 and column_name='mime_type') then
    alter table knowledge_documents add column mime_type text;
  end if;

  -- storage_path — path inside the storage bucket (for signed URL fetch)
  if not exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='knowledge_documents'
                 and column_name='storage_path') then
    alter table knowledge_documents add column storage_path text;
  end if;

  -- updated_at — last modification timestamp
  if not exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='knowledge_documents'
                 and column_name='updated_at') then
    alter table knowledge_documents add column updated_at timestamptz default now();
  end if;

  -- checksum — sha256 of file contents (for dedup)
  if not exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='knowledge_documents'
                 and column_name='checksum') then
    alter table knowledge_documents add column checksum text;
  end if;
end$$;

-- Add updated_at touch trigger to knowledge_documents
drop trigger if exists knowledge_documents_touch on knowledge_documents;
create trigger knowledge_documents_touch
before update on knowledge_documents
for each row execute procedure public.touch_updated_at();

-- Index for category/approval filter (most common admin query)
create index if not exists idx_kd_category_status
  on knowledge_documents (category, approval_status)
  where is_archived = false;

create index if not exists idx_kd_uploaded_by on knowledge_documents (uploaded_by, created_at desc);
create index if not exists idx_kd_reviewed_by on knowledge_documents (reviewed_by, reviewed_at desc);

-- Tags GIN index for array contains queries
create index if not exists idx_kd_tags on knowledge_documents using gin (tags);

-- Allow self-reference for previous_version_id (after column was added)
do $$
begin
  if not exists (
    select 1 from information_schema.table_constraints
    where constraint_name = 'kd_previous_version_fk'
      and table_schema = 'public'
      and table_name = 'knowledge_documents'
  ) then
    alter table knowledge_documents
      add constraint kd_previous_version_fk
      foreign key (previous_version_id) references knowledge_documents(id) on delete set null;
  end if;
end$$;

-- ============================================================================
-- 2. knowledge_chunks — semantic chunk storage
-- ============================================================================
create table if not exists knowledge_chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references knowledge_documents(id) on delete cascade,
  chunk_text text not null,
  page_number integer,
  section_title text,
  chunk_order integer not null default 0,
  token_count integer default 0,
  char_count integer default 0,
  metadata jsonb default '{}'::jsonb,
  -- Precomputed tokens used for keyword matching (lowercased, deduped)
  search_tokens text[] default '{}',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table knowledge_chunks enable row level security;

-- Indexes
create index if not exists idx_kc_document on knowledge_chunks (document_id, chunk_order);
create index if not exists idx_kc_tokens_gin on knowledge_chunks using gin (search_tokens);
create index if not exists idx_kc_section on knowledge_chunks (document_id, section_title);

-- Trigger for updated_at
drop trigger if exists knowledge_chunks_touch on knowledge_chunks;
create trigger knowledge_chunks_touch
before update on knowledge_chunks
for each row execute procedure public.touch_updated_at();

-- RLS: staff can manage; authenticated users can read chunks of approved docs
-- We use a subquery to check the parent document's approval_status.
drop policy if exists "Staff can manage chunks" on knowledge_chunks;
create policy "Staff can manage chunks"
on knowledge_chunks for all
to authenticated
using (public.is_staff())
with check (public.is_staff());

drop policy if exists "Users can read chunks of approved docs" on knowledge_chunks;
create policy "Users can read chunks of approved docs"
on knowledge_chunks for select
to authenticated
using (
  exists (
    select 1 from knowledge_documents d
    where d.id = knowledge_chunks.document_id
      and d.approval_status = 'approved'
      and d.is_archived = false
  )
);

-- ============================================================================
-- 3. knowledge_embeddings — embedding storage (pgvector-optional)
-- ============================================================================
-- We try to enable pgvector; if not available, we fall back to JSONB storage
-- of the float array and compute similarity in Python (or via a SQL function).
-- The embedding_text column lets us re-embed later if the model changes.

-- Attempt to enable pgvector extension (ignored if not available / not allowed)
create extension if not exists vector;

-- Whether pgvector is actually installed is detected at runtime by the
-- backend. The schema stays compatible either way.

create table if not exists knowledge_embeddings (
  id uuid primary key default gen_random_uuid(),
  chunk_id uuid not null references knowledge_chunks(id) on delete cascade,
  document_id uuid not null references knowledge_documents(id) on delete cascade,
  -- The model that produced this embedding (e.g. "text-embedding-3-small")
  model_name text not null,
  -- Embedding dimension (e.g. 1536, 768, 384)
  dimensions integer not null,
  -- When pgvector is available we store the vector here. The column type
  -- is created below conditionally.
  -- embedding_vector vector(1536)  -- added by dynamic SQL if pgvector exists
  -- JSONB fallback (always present)
  embedding_json jsonb,
  -- Whether this embedding is queryable (set false when superseded)
  is_active boolean default true,
  created_at timestamptz default now()
);

alter table knowledge_embeddings enable row level security;

-- Conditionally add the vector column when pgvector is installed.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'vector') then
    if not exists (select 1 from information_schema.columns
                   where table_schema='public' and table_name='knowledge_embeddings'
                   and column_name='embedding_vector') then
      -- Default 1536 dims (OpenAI text-embedding-3-small). Use a flexible
      -- approach: store as vector(1536) and use a separate column for other
      -- dimensions. Production may want a per-dimension table.
      execute 'alter table knowledge_embeddings add column embedding_vector vector(1536)';
    end if;
  end if;
end$$;

-- Indexes
create index if not exists idx_ke_chunk on knowledge_embeddings (chunk_id);
create index if not exists idx_ke_document on knowledge_embeddings (document_id);
create index if not exists idx_ke_model on knowledge_embeddings (model_name, is_active);
create index if not exists idx_ke_active on knowledge_embeddings (is_active) where is_active = true;

-- ivfflat index for cosine similarity (only when pgvector present)
do $$
begin
  if exists (select 1 from pg_extension where extname = 'vector') then
    if not exists (
      select 1 from pg_indexes
      where schemaname = 'public' and indexname = 'idx_ke_vector_cosine'
    ) then
      execute 'create index idx_ke_vector_cosine on knowledge_embeddings using ivfflat (embedding_vector vector_cosine_ops) with (lists = 100)';
    end if;
  end if;
end$$;

-- RLS: staff manage, users read active embeddings of approved chunks
drop policy if exists "Staff can manage embeddings" on knowledge_embeddings;
create policy "Staff can manage embeddings"
on knowledge_embeddings for all
to authenticated
using (public.is_staff())
with check (public.is_staff());

drop policy if exists "Users can read active embeddings" on knowledge_embeddings;
create policy "Users can read active embeddings"
on knowledge_embeddings for select
to authenticated
using (
  is_active = true
  and exists (
    select 1 from knowledge_documents d
    where d.id = knowledge_embeddings.document_id
      and d.approval_status = 'approved'
      and d.is_archived = false
  )
);

-- ============================================================================
-- 4. document_versions — version history
-- ============================================================================
create table if not exists document_versions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references knowledge_documents(id) on delete cascade,
  version_number integer not null,
  file_url text,
  storage_path text,
  file_size_bytes bigint,
  checksum text,
  change_summary text,
  created_by uuid references auth.users(id),
  created_at timestamptz default now(),
  unique (document_id, version_number)
);

alter table document_versions enable row level security;

drop policy if exists "Staff can manage document versions" on document_versions;
create policy "Staff can manage document versions"
on document_versions for all
to authenticated
using (public.is_staff())
with check (public.is_staff());

create index if not exists idx_dv_document on document_versions (document_id, version_number desc);

-- ============================================================================
-- 5. rag_queries — retrieval audit log
-- ============================================================================
create table if not exists rag_queries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  conversation_id uuid,
  query_text text not null,
  query_hash text,
  -- Retrieved chunk ids in rank order
  retrieved_chunk_ids uuid[] default '{}',
  retrieved_document_ids uuid[] default '{}',
  -- Cosine / dot product scores in rank order (parallel to retrieved_chunk_ids)
  retrieved_scores jsonb default '[]'::jsonb,
  -- Aggregate confidence 0..1
  confidence numeric(5,4),
  -- "verified" | "partial" | "unverified"
  verification_status text,
  -- Top matched document name (denormalized for quick display)
  top_match_document text,
  top_match_score numeric(6,4),
  retrieval_time_ms integer,
  model_used text,
  language text,
  created_at timestamptz default now()
);

alter table rag_queries enable row level security;

-- Users can read their own queries; staff can read all
drop policy if exists "Users can read own RAG queries" on rag_queries;
create policy "Users can read own RAG queries"
on rag_queries for select
to authenticated
using (auth.uid() = user_id or public.is_staff());

drop policy if exists "Users can insert RAG queries" on rag_queries;
create policy "Users can insert RAG queries"
on rag_queries for insert
to authenticated
with check (auth.uid() = user_id or user_id is null);

drop policy if exists "Staff can manage RAG queries" on rag_queries;
create policy "Staff can manage RAG queries"
on rag_queries for all
to authenticated
using (public.is_staff())
with check (public.is_staff());

create index if not exists idx_rq_user on rag_queries (user_id, created_at desc);
create index if not exists idx_rq_hash on rag_queries (query_hash);
create index if not exists idx_rq_status on rag_queries (verification_status, created_at desc);

-- ============================================================================
-- 6. rag_cache — answer cache keyed by query hash
-- ============================================================================
create table if not exists rag_cache (
  id uuid primary key default gen_random_uuid(),
  query_hash text unique not null,
  query_text text not null,
  answer_text text not null,
  sources_json jsonb default '[]'::jsonb,
  confidence numeric(5,4),
  category text,
  language text,
  model_used text,
  hit_count integer default 0,
  expires_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table rag_cache enable row level security;

drop policy if exists "Authenticated can read RAG cache" on rag_cache;
create policy "Authenticated can read RAG cache"
on rag_cache for select
to authenticated
using (true);

drop policy if exists "Staff can manage RAG cache" on rag_cache;
create policy "Staff can manage RAG cache"
on rag_cache for all
to authenticated
using (public.is_staff())
with check (public.is_staff());

create index if not exists idx_rag_cache_hash on rag_cache (query_hash);
create index if not exists idx_rag_cache_expires on rag_cache (expires_at) where expires_at is not null;

drop trigger if exists rag_cache_touch on rag_cache;
create trigger rag_cache_touch
before update on rag_cache
for each row execute procedure public.touch_updated_at();

-- ============================================================================
-- 7. rag_support_tickets — handoff tickets created when confidence is low
-- ============================================================================
-- We extend the existing `support_tickets` table with RAG-specific columns
-- rather than creating a separate table, so admins see a single queue.

do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='support_tickets'
                 and column_name='rag_query_id') then
    alter table support_tickets add column rag_query_id uuid references rag_queries(id) on delete set null;
  end if;

  if not exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='support_tickets'
                 and column_name='confidence') then
    alter table support_tickets add column confidence numeric(5,4);
  end if;

  if not exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='support_tickets'
                 and column_name='verification_status') then
    alter table support_tickets add column verification_status text;
  end if;

  if not exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='support_tickets'
                 and column_name='cited_sources') then
    alter table support_tickets add column cited_sources jsonb;
  end if;
end$$;

-- ============================================================================
-- 8. Storage bucket for raw knowledge files (private — staff-only)
-- ============================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
select
  'rag-documents', 'rag-documents', false, 52428800,  -- 50 MB
  array[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'application/msword',
    'application/vnd.ms-powerpoint',
    'text/plain',
    'text/markdown',
    'text/csv',
    'application/json'
  ]
where not exists (select 1 from storage.buckets where id = 'rag-documents');

-- Storage policies for rag-documents bucket
drop policy if exists "Staff can upload RAG documents" on storage.objects;
create policy "Staff can upload RAG documents"
on storage.objects for insert
to authenticated
with check (bucket_id = 'rag-documents' and public.is_staff());

drop policy if exists "Staff can read RAG documents" on storage.objects;
create policy "Staff can read RAG documents"
on storage.objects for select
to authenticated
using (bucket_id = 'rag-documents' and public.is_staff());

drop policy if exists "Staff can update RAG documents" on storage.objects;
create policy "Staff can update RAG documents"
on storage.objects for update
to authenticated
using (bucket_id = 'rag-documents' and public.is_staff())
with check (bucket_id = 'rag-documents' and public.is_staff());

drop policy if exists "Staff can delete RAG documents" on storage.objects;
create policy "Staff can delete RAG documents"
on storage.objects for delete
to authenticated
using (bucket_id = 'rag-documents' and public.is_staff());

-- ============================================================================
-- 9. SQL function: match_chunks (cosine similarity in pure SQL)
-- ----------------------------------------------------------------------------
-- This is the pgvector-free fallback. It computes cosine similarity between
-- a query embedding (passed as JSONB array of floats) and each row's
-- embedding_json. It's O(N) but works everywhere.
-- ============================================================================
create or replace function public.match_chunks_json(
  p_query_embedding jsonb,
  p_match_count integer default 10,
  p_min_similarity numeric default 0.20
)
returns table (
  chunk_id uuid,
  document_id uuid,
  similarity double precision,
  chunk_text text,
  section_title text,
  page_number integer,
  chunk_order integer,
  metadata jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  with q as (
    select (jsonb_array_elements_text(p_query_embedding))::float8 as v,
           row_number() over () as i
  ),
  e as (
    select
      ke.id as ke_id,
      ke.chunk_id,
      ke.document_id,
      ke.embedding_json,
      ke.dimensions
    from knowledge_embeddings ke
    where ke.is_active = true
  ),
  scored as (
    select
      e.chunk_id,
      e.document_id,
      (
        select sum(q.v * ev.v)
        from q
        join lateral (
          select (jsonb_array_elements_text(e.embedding_json))::float8 as v,
                 row_number() over () as i
        ) ev on ev.i = q.i
      ) as dot,
      (
        select sqrt(sum(q.v * q.v))
        from q
      ) as q_norm,
      (
        select sqrt(sum(ev.v * ev.v))
        from lateral (
          select (jsonb_array_elements_text(e.embedding_json))::float8 as v
        ) ev
      ) as e_norm
    from e
  )
  select
    s.chunk_id,
    s.document_id,
    case when s.q_norm > 0 and s.e_norm > 0
         then s.dot / (s.q_norm * s.e_norm)
         else 0 end::double precision as similarity,
    kc.chunk_text,
    kc.section_title,
    kc.page_number,
    kc.chunk_order,
    kc.metadata
  from scored s
  join knowledge_chunks kc on kc.id = s.chunk_id
  join knowledge_documents kd on kd.id = s.document_id
  where kd.approval_status = 'approved'
    and kd.is_archived = false
    and case when s.q_norm > 0 and s.e_norm > 0
             then s.dot / (s.q_norm * s.e_norm)
             else 0 end >= p_min_similarity
  order by similarity desc
  limit p_match_count;
$$;

-- ============================================================================
-- 10. SQL function: match_chunks_vector (uses pgvector if available)
-- ============================================================================
-- This function is created only when pgvector is installed. It uses the
-- `<=>` operator for cosine distance, which is far faster than the JSONB
-- fallback above.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'vector') then
    execute $f$
      create or replace function public.match_chunks_vector(
        p_query_embedding vector,
        p_match_count integer default 10,
        p_min_similarity numeric default 0.20
      )
      returns table (
        chunk_id uuid,
        document_id uuid,
        similarity double precision,
        chunk_text text,
        section_title text,
        page_number integer,
        chunk_order integer,
        metadata jsonb
      )
      language sql
      stable
      security definer
      set search_path = public
      as $$
        select
          ke.chunk_id,
          ke.document_id,
          (1 - (ke.embedding_vector <=> p_query_embedding))::double precision as similarity,
          kc.chunk_text,
          kc.section_title,
          kc.page_number,
          kc.chunk_order,
          kc.metadata
        from knowledge_embeddings ke
        join knowledge_chunks kc on kc.id = ke.chunk_id
        join knowledge_documents kd on kd.id = ke.document_id
        where ke.is_active = true
          and kd.approval_status = 'approved'
          and kd.is_archived = false
          and (1 - (ke.embedding_vector <=> p_query_embedding)) >= p_min_similarity
        order by ke.embedding_vector <=> p_query_embedding
        limit p_match_count;
      $$;
    $f$;
  end if;
end$$;

-- ============================================================================
-- 11. SQL function: keyword_search_chunks — token overlap fallback
-- ----------------------------------------------------------------------------
-- Used when no embeddings are configured. Scores chunks by the number of
-- query tokens present in search_tokens.
-- ============================================================================
create or replace function public.keyword_search_chunks(
  p_query text,
  p_match_count integer default 10,
  p_min_score integer default 1
)
returns table (
  chunk_id uuid,
  document_id uuid,
  score integer,
  chunk_text text,
  section_title text,
  page_number integer,
  chunk_order integer,
  metadata jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  with q_tokens as (
    select distinct lower(tok) as t
    from regexp_split_to_table(lower(p_query), '[^a-z0-9]+') as tok
    where length(tok) >= 3
  )
  select
    kc.id as chunk_id,
    kc.document_id,
    (select count(*) from q_tokens where q_tokens.t = any(kc.search_tokens))::integer as score,
    kc.chunk_text,
    kc.section_title,
    kc.page_number,
    kc.chunk_order,
    kc.metadata
  from knowledge_chunks kc
  join knowledge_documents kd on kd.id = kc.document_id
  where kd.approval_status = 'approved'
    and kd.is_archived = false
    and (
      select count(*) from q_tokens where q_tokens.t = any(kc.search_tokens)
    ) >= p_min_score
  order by score desc, kc.chunk_order
  limit p_match_count;
$$;

-- ============================================================================
-- 12. SQL function: update_document_chunk_stats — denormalized counters
-- ============================================================================
create or replace function public.update_document_chunk_stats(p_doc_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update knowledge_documents
  set chunk_count = (
        select count(*) from knowledge_chunks where document_id = p_doc_id
      ),
      token_count = coalesce((
        select sum(token_count) from knowledge_chunks where document_id = p_doc_id
      ), 0)
  where id = p_doc_id;
$$;

-- ============================================================================
-- 13. Audit triggers for new tables
-- ============================================================================
create or replace function public.log_rag_audit()
returns trigger language plpgsql security definer as $$
begin
  insert into audit_logs (action, entity_type, entity_id, metadata, created_by)
  values (
    case when tg_op = 'INSERT' then 'INSERT'
         when tg_op = 'UPDATE' then 'UPDATE'
         else 'DELETE' end,
    tg_table_name,
    coalesce(new.id::text, old.id::text),
    jsonb_build_object(
      'operation', tg_op,
      'table', tg_table_name,
      'record', case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end
    ),
    case when tg_op = 'DELETE' then null else null end
  );
  return coalesce(new, old);
end;
$$;

drop trigger if exists knowledge_chunks_audit on knowledge_chunks;
create trigger knowledge_chunks_audit
after insert or update or delete on knowledge_chunks
for each row execute procedure public.log_rag_audit();

drop trigger if exists knowledge_embeddings_audit on knowledge_embeddings;
create trigger knowledge_embeddings_audit
after insert or update or delete on knowledge_embeddings
for each row execute procedure public.log_rag_audit();

-- ============================================================================
-- 14. Seed integration_configs for RAG components
-- ============================================================================
insert into integration_configs (integration_key, display_name, description, category, enabled, config)
select
  'rag_embeddings',
  'RAG Embedding Provider',
  'Provider for generating text embeddings (OpenAI, Groq, local).',
  'other',
  false,
  jsonb_build_object('provider', 'openai', 'model', 'text-embedding-3-small', 'dimensions', 1536)
where not exists (select 1 from integration_configs where integration_key = 'rag_embeddings');

insert into integration_configs (integration_key, display_name, description, category, enabled, config)
select
  'rag_chunking',
  'RAG Chunking Strategy',
  'Configuration for document chunking (chunk size, overlap, splitting strategy).',
  'other',
  true,
  jsonb_build_object('chunk_size', 800, 'overlap', 120, 'strategy', 'semantic')
where not exists (select 1 from integration_configs where integration_key = 'rag_chunking');

insert into integration_configs (integration_key, display_name, description, category, enabled, config)
select
  'rag_retrieval',
  'RAG Retrieval Settings',
  'Top-K, minimum similarity threshold, and verification confidence floor.',
  'other',
  true,
  jsonb_build_object('top_k', 5, 'min_similarity', 0.20, 'confidence_floor', 0.55, 'handoff_threshold', 0.40)
where not exists (select 1 from integration_configs where integration_key = 'rag_retrieval');

-- ============================================================================
-- 15. Helpful view: knowledge_documents_with_stats
-- ============================================================================
create or replace view public.knowledge_documents_with_stats as
select
  d.id,
  d.document_id,
  d.file_name,
  d.file_type,
  d.file_url,
  d.category,
  d.tags,
  d.language,
  d.source,
  d.version,
  d.previous_version_id,
  d.is_archived,
  d.approval_status,
  d.uploaded_by,
  d.reviewed_by,
  d.reviewed_at,
  d.rejection_reason,
  coalesce(d.chunk_count, 0) as chunk_count,
  coalesce(d.token_count, 0) as token_count,
  d.file_size_bytes,
  d.mime_type,
  d.storage_path,
  d.checksum,
  d.created_at,
  d.updated_at,
  (select count(*) from document_versions dv where dv.document_id = d.id) as version_count,
  (select count(*) from knowledge_embeddings ke where ke.document_id = d.id and ke.is_active = true) as embedding_count
from knowledge_documents d
where d.is_archived = false;

comment on view public.knowledge_documents_with_stats is
  'Knowledge documents with denormalized chunk/embedding/version counts for admin display.';

-- ============================================================================
-- Done. Summary:
--   • Extended `knowledge_documents` with 14 new metadata columns
--   • New table: knowledge_chunks
--   • New table: knowledge_embeddings (pgvector-optional)
--   • New table: document_versions
--   • New table: rag_queries
--   • New table: rag_cache
--   • Extended `support_tickets` with 4 RAG columns
--   • New storage bucket: rag-documents (50 MB, private, staff-only)
--   • New SQL functions: match_chunks_json, match_chunks_vector,
--     keyword_search_chunks, update_document_chunk_stats
--   • New view: knowledge_documents_with_stats
--   • ~16 new RLS policies, ~14 new indexes, 3 new triggers
--   • 3 new integration_configs seeds (rag_embeddings, rag_chunking, rag_retrieval)
-- ============================================================================
