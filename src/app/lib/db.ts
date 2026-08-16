import { supabase, isSupabaseConfigured } from "./supabaseClient";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Cast helper for call sites that have already checked `isMissingSupabase()`.
 * The real client is non-null when configured; this avoids `!` non-null
 * assertions being flagged as `never` by strict TypeScript.
 */
type NonNullClient = SupabaseClient;
const client = (): NonNullClient => supabase as unknown as NonNullClient;
import {
  products as demoProducts,
  faqItems as demoFaqs,
  documents as demoDocuments,
  leads as demoLeads,
  tickets as demoTickets,
} from "./demoData";

export type Product = {
  id?: string;
  product_name: string;
  brand?: string | null;
  category: string;
  sub_category?: string | null;
  sku?: string | null;
  problem_tags?: string[] | null;
  benefits?: string | null;
  ingredients?: string | null;
  usage?: string | null;
  warnings?: string | null;
  who_can_use?: string | null;
  safety_note?: string | null;
  source?: string | null;
  approval_status?: string | null;
  is_archived?: boolean | null;
  faqs_json?: Record<string, unknown> | null;
  created_at?: string | null;
  tags?: string[] | null; // kept for existing UI usage
  /** Primary product photo, flattened from the product_images table (see
   * getProducts()) — the Product type never carried an image field before,
   * so no product card anywhere could show a real photo. */
  image_url?: string | null;
};

type ProductImageRow = { image_url: string | null; is_primary: boolean | null; display_order: number | null };

/** Picks the primary (or first, by display_order) image from a product's
 * embedded product_images rows. */
function pickPrimaryImage(images: ProductImageRow[] | null | undefined): string | null {
  if (!images || images.length === 0) return null;
  const sorted = [...images].sort((a, b) => {
    if (a.is_primary && !b.is_primary) return -1;
    if (!a.is_primary && b.is_primary) return 1;
    return (a.display_order ?? 0) - (b.display_order ?? 0);
  });
  return sorted[0]?.image_url ?? null;
}

export type FAQ = {
  id?: string;
  question: string;
  answer: string;
  category?: string | null;
  approval_status?: string | null;
  created_at?: string | null;
};

export type Lead = {
  id?: string;
  full_name: string;
  phone?: string | null;
  email?: string | null;
  city?: string | null;
  state?: string | null;
  region?: string | null;
  interested_category?: string | null;
  lead_type?: "customer" | "distributor" | null;
  preferred_language?: string | null;
  notes?: string | null;
  status?: string | null;
  created_by?: string | null;
  created_at?: string | null;
};

export type LeadInsert = Lead;

export type AnalyticsEvent = {
  id?: string;
  user_id?: string | null;
  role?: string | null;
  language?: string | null;
  query?: string | null;
  category?: string | null;
  source_used?: string | null;
  safety_status?: string | null;
  created_at?: string | null;
};

const fallbackWarn = (label: string, err?: unknown): void => {
  if (err instanceof Error) {
    console.warn(`[db fallback] ${label}: ${err.message}`);
  } else if (err) {
    console.warn(`[db fallback] ${label}:`, err);
  } else {
    console.warn(`[db fallback] ${label}`);
  }
};

function isMissingSupabase(): boolean {
  return !isSupabaseConfigured();
}

/**
 * READ HELPERS
 */
async function safeSelect<T>(
  fn: () => Promise<{ data: unknown; error: unknown }>,
  label: string
): Promise<T[]> {
  if (isMissingSupabase()) return [];
  try {
    const { data, error } = await fn();

    if (error) {
      const message =
        error instanceof Error
          ? error.message
          : typeof error === "object" && error !== null && "message" in error
            ? String((error as { message?: unknown }).message ?? "Supabase error")
            : "Supabase error";
      throw new Error(message);
    }

    // Supabase typings vary depending on query; normalize at runtime.
    if (!Array.isArray(data)) return [];

    // Some Supabase queries can be typed/returned as nested arrays.
    const first = (data as unknown[])[0];
    if (Array.isArray(first)) {
      return (data as unknown[][]).flat() as T[];
    }

    return data as T[];
  } catch (err) {
    fallbackWarn(label, err);
    return [];
  }
}

/**
 * Return demo products mapped into DB/UI compatible shape.
 * Your demoData.ts currently has a smaller product schema; keep the UI working.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function normalizeTextToTags(value: unknown): string[] | null {
  if (value == null) return null;
  if (Array.isArray(value)) {
    const cleaned = value.map((v) => String(v).trim()).filter(Boolean);
    return cleaned.length ? cleaned : null;
  }
  if (typeof value === "string") {
    // Supports comma-separated or newline-separated tags.
    const cleaned = value
      .split(/[,;\n]+/g)
      .map((v) => v.trim())
      .filter(Boolean);
    return cleaned.length ? cleaned : null;
  }
  return null;
}

function mapDemoProducts(): Product[] {
  return demoProducts.map((p) => ({
    product_name: p.name,
    brand: p.brand ?? null,
    category: p.category,
    problem_tags: p.tags ?? null,
    benefits: p.benefits ?? null,
    ingredients: null,
    usage: (p as { usage?: string }).usage ?? null,
    who_can_use: null,
    safety_note: (p as { safety?: string }).safety ?? null,
    source: null,
    approval_status: "approved",
    tags: p.tags ?? null,
  }));
}

function mapDemoFaqs(): FAQ[] {
  return demoFaqs.map((f, i) => ({
    id: String(i),
    question: f.question,
    answer: f.answer,
    approval_status: "approved",
  }));
}

function mapDemoLeads(): Lead[] {
  return demoLeads.map((l, i) => ({
    id: String(i),
    full_name: l.name,
    phone: l.phone ?? null,
    email: null,
    city: null,
    state: null,
    region: l.region ?? null,
    interested_category: l.category ?? null,
    lead_type: (l.type?.toLowerCase?.() === "distributor" ? "distributor" : "customer") as
      | "customer"
      | "distributor",
    preferred_language: null,
    notes: null,
    status: l.status ?? null,
    created_by: null,
  }));
}

/**
 * DB SERVICES (with demo fallbacks)
 */

// Products
export async function getProducts(): Promise<Product[]> {
  if (isMissingSupabase()) return mapDemoProducts();

  const rows = await safeSelect<Product & { product_images?: ProductImageRow[] }>(async () => {
    const { data, error } = await client()
      .from("products")
      .select("*, product_images(image_url, is_primary, display_order)")
      .eq("approval_status", "approved")
      .order("created_at", { ascending: false });

    return { data: (data as unknown as (Product & { product_images?: ProductImageRow[] })[] | null) ?? null, error };
  }, "getProducts");

  const withImages = rows.map(({ product_images, ...product }) => ({
    ...product,
    image_url: pickPrimaryImage(product_images),
  }));

  return withImages.length ? withImages : mapDemoProducts();
}

export async function getAllProductsForAdmin(): Promise<Product[]> {
  if (isMissingSupabase()) return mapDemoProducts();

  const rows = await safeSelect<Product>(async () => {
    const { data, error } = await client()
      .from("products")
      .select("*")
      .order("created_at", { ascending: false });

    return { data: (data as unknown as Product[] | null) ?? null, error };
  }, "getAllProductsForAdmin");

  return rows;
}

export async function createProduct(input: Omit<Product, "id" | "created_at" | "created_by" | "approval_status"> & { approval_status?: Product["approval_status"] }): Promise<Product> {
  if (isMissingSupabase()) {
    fallbackWarn("createProduct (local fallback)");
    return {
      ...input,
      id: "demo-created",
      approval_status: input.approval_status ?? "pending",
      created_at: new Date().toISOString(),
    };
  }

  try {
    const { data, error } = await client()
      .from("products")
      .insert([
        {
          product_id: (input as any).product_id ?? null,
          product_name: input.product_name,
          brand: input.brand ?? null,
          category: input.category,
          sub_category: input.sub_category ?? null,
          problem_tags: input.problem_tags ?? null,
          benefits: input.benefits ?? null,
          ingredients: input.ingredients ?? null,
          usage: input.usage ?? null,
          who_can_use: input.who_can_use ?? null,
          safety_note: input.safety_note ?? null,
          source: input.source ?? null,
          approval_status: input.approval_status ?? "pending",
        },
      ])
      .select("*")
      .single();

    if (error) throw new Error(error.message);
    return data as Product;
  } catch (err) {
    fallbackWarn("createProduct (db failed)", err);
    // Safe fallback
    return {
      ...input,
      id: "demo-created",
      approval_status: input.approval_status ?? "pending",
      created_at: new Date().toISOString(),
    };
  }
}

export async function updateProduct(productId: string, patch: Partial<Product>): Promise<Product> {
  if (isMissingSupabase()) {
    fallbackWarn("updateProduct (local fallback)");
    return {
      id: productId,
      product_name: patch.product_name ?? "Demo Product",
      brand: patch.brand ?? null,
      category: patch.category ?? "Category",
      sub_category: patch.sub_category ?? null,
      problem_tags: patch.problem_tags ?? null,
      benefits: patch.benefits ?? null,
      ingredients: patch.ingredients ?? null,
      usage: patch.usage ?? null,
      who_can_use: patch.who_can_use ?? null,
      safety_note: patch.safety_note ?? null,
      source: patch.source ?? null,
      approval_status: patch.approval_status ?? "pending",
      tags: patch.tags ?? null,
      created_at: new Date().toISOString(),
    };
  }

  try {
    const { data, error } = await client()
      .from("products")
      .update({
        product_name: patch.product_name ?? undefined,
        brand: patch.brand ?? undefined,
        category: patch.category ?? undefined,
        sub_category: patch.sub_category ?? undefined,
        problem_tags: patch.problem_tags ?? undefined,
        benefits: patch.benefits ?? undefined,
        ingredients: patch.ingredients ?? undefined,
        usage: patch.usage ?? undefined,
        who_can_use: patch.who_can_use ?? undefined,
        safety_note: patch.safety_note ?? undefined,
        source: patch.source ?? undefined,
        approval_status: patch.approval_status ?? undefined,
      })
      .eq("id", productId)
      .select("*")
      .single();

    if (error) throw new Error(error.message);
    return data as Product;
  } catch (err) {
    fallbackWarn("updateProduct (db failed)", err);
    return {
      ...(patch as Product),
      id: productId,
      product_name: patch.product_name ?? "Demo Product",
      category: patch.category ?? "Category",
      approval_status: patch.approval_status ?? "pending",
      created_at: new Date().toISOString(),
    };
  }
}

export async function deleteProduct(productId: string): Promise<void> {
  if (isMissingSupabase()) {
    fallbackWarn("deleteProduct (local fallback)");
    return;
  }

  try {
    const { error } = await client().from("products").delete().eq("id", productId);
    if (error) throw new Error(error.message);
  } catch (err) {
    fallbackWarn("deleteProduct (db failed)", err);
    throw err instanceof Error ? err : new Error("Failed to delete product");
  }
}

export async function setProductApprovalStatus(
  productId: string,
  approval_status: "approved" | "pending" | "rejected"
): Promise<Product> {
  return updateProduct(productId, { approval_status });
}

// FAQs
export async function getFaqs(): Promise<FAQ[]> {
  if (isMissingSupabase()) return mapDemoFaqs();

  const rows = await safeSelect<FAQ>(async () => {
    const { data, error } = await client()
      .from("faqs")
      .select("*")
      .eq("approval_status", "approved")
      .order("created_at", { ascending: false });

    return { data: (data as unknown as FAQ[] | null) ?? null, error };
  }, "getFaqs");

  return rows.length ? rows : mapDemoFaqs();
}

export async function getFaqsForManager(): Promise<FAQ[]> {
  if (isMissingSupabase()) return mapDemoFaqs();

  const rows = await safeSelect<FAQ>(async () => {
    const { data, error } = await client()
      .from("faqs")
      .select("*")
      .order("created_at", { ascending: false });

    return { data: (data as unknown as FAQ[] | null) ?? null, error };
  }, "getFaqsForManager");

  return rows.length ? rows : mapDemoFaqs();
}

export async function createFaq(input: { question: string; answer: string; approval_status?: FAQ["approval_status"] }): Promise<FAQ> {
  if (isMissingSupabase()) {
    fallbackWarn("createFaq (local fallback)");
    return {
      id: "demo-faq-created",
      question: input.question,
      answer: input.answer,
      approval_status: input.approval_status ?? "pending",
      created_at: new Date().toISOString(),
    };
  }

  const { question, answer, approval_status } = input;

  try {
    const { data, error } = await client()
      .from("faqs")
      .insert([
        {
          question,
          answer,
          approval_status: approval_status ?? "pending",
        },
      ])
      .select("*")
      .single();

    if (error) throw new Error(error.message);
    return data as FAQ;
  } catch (err) {
    fallbackWarn("createFaq (db failed)", err);
    return {
      id: "demo-faq-created",
      question,
      answer,
      approval_status: approval_status ?? "pending",
      created_at: new Date().toISOString(),
    };
  }
}

export async function updateFaq(faqId: string, patch: Partial<Pick<FAQ, "question" | "answer" | "approval_status">>): Promise<FAQ> {
  if (isMissingSupabase()) {
    fallbackWarn("updateFaq (local fallback)");
    return {
      id: faqId,
      question: patch.question ?? "Demo Question",
      answer: patch.answer ?? "Demo Answer",
      approval_status: patch.approval_status ?? "pending",
      created_at: new Date().toISOString(),
    };
  }

  try {
    const { data, error } = await client()
      .from("faqs")
      .update({
        question: patch.question ?? undefined,
        answer: patch.answer ?? undefined,
        approval_status: patch.approval_status ?? undefined,
      })
      .eq("id", faqId)
      .select("*")
      .single();

    if (error) throw new Error(error.message);
    return data as FAQ;
  } catch (err) {
    fallbackWarn("updateFaq (db failed)", err);
    return {
      id: faqId,
      question: patch.question ?? "Demo Question",
      answer: patch.answer ?? "Demo Answer",
      approval_status: patch.approval_status ?? "pending",
      created_at: new Date().toISOString(),
    };
  }
}

export async function deleteFaq(faqId: string): Promise<void> {
  if (isMissingSupabase()) {
    fallbackWarn("deleteFaq (local fallback)");
    return;
  }

  try {
    const { error } = await client().from("faqs").delete().eq("id", faqId);
    if (error) throw new Error(error.message);
  } catch (err) {
    fallbackWarn("deleteFaq (db failed)", err);
    throw err instanceof Error ? err : new Error("Failed to delete FAQ");
  }
}

export async function approveFaq(faqId: string, nextStatus: FAQ["approval_status"] = "approved"): Promise<FAQ> {
  return updateFaq(faqId, { approval_status: nextStatus });
}


export type Policy = {
  id?: string;
  policy_id?: string | null;
  topic: string;
  content: string;
  source?: string | null;
  approval_status?: "pending" | "approved" | "rejected" | null;
  created_at?: string | null;
};

export async function getPolicies(): Promise<Record<string, unknown>[]> {
  if (isMissingSupabase()) return [];
  const rows = await safeSelect<Record<string, unknown>>(async () => {
    const { data, error } = await client()
      .from("policies")
      .select("*")
      .eq("approval_status", "approved")
      .order("created_at", { ascending: false });

    return { data: (data as Record<string, unknown>[] | null) ?? null, error };
  }, "getPolicies");

  return rows;
}

export async function getPoliciesForManager(): Promise<Policy[]> {
  if (isMissingSupabase()) {
    const demo = (demoDocuments as unknown as Array<{ topic?: string; content?: string; approval_status?: string; id?: string }>).slice(0, 0);
    void demo;
    // Reuse map via approved fallback-less: return empty safe.
    return [];
  }

  const rows = await safeSelect<Policy>(async () => {
    const { data, error } = await client()
      .from("policies")
      .select("*")
      .order("created_at", { ascending: false });

    return { data: (data as Policy[] | null) ?? null, error };
  }, "getPoliciesForManager");

  return rows;
}

export async function createPolicy(input: {
  topic: string;
  content: string;
  policy_id?: string | null;
  source?: string | null;
  approval_status?: Policy["approval_status"];
}): Promise<Policy> {
  if (isMissingSupabase()) {
    fallbackWarn("createPolicy (local fallback)");
    return {
      id: "demo-policy-created",
      topic: input.topic,
      content: input.content,
      policy_id: input.policy_id ?? null,
      source: input.source ?? null,
      approval_status: input.approval_status ?? "pending",
      created_at: new Date().toISOString(),
    };
  }

  const { data, error } = await client()
    .from("policies")
    .insert([
      {
        policy_id: input.policy_id ?? null,
        topic: input.topic,
        content: input.content,
        source: input.source ?? null,
        approval_status: input.approval_status ?? "pending",
      },
    ])
    .select("*")
    .single();

  if (error) throw new Error(error.message);
  return data as Policy;
}

export async function updatePolicy(
  policyId: string,
  patch: Partial<Pick<Policy, "topic" | "content" | "source" | "approval_status" | "policy_id">>
): Promise<Policy> {
  if (isMissingSupabase()) {
    fallbackWarn("updatePolicy (local fallback)");
    return {
      id: policyId,
      topic: patch.topic ?? "Demo Policy",
      content: patch.content ?? "Demo content",
      source: patch.source ?? null,
      policy_id: patch.policy_id ?? null,
      approval_status: patch.approval_status ?? "pending",
      created_at: new Date().toISOString(),
    };
  }

  const { data, error } = await client()
    .from("policies")
    .update({
      topic: patch.topic ?? undefined,
      content: patch.content ?? undefined,
      source: patch.source ?? undefined,
      policy_id: patch.policy_id ?? undefined,
      approval_status: patch.approval_status ?? undefined,
    })
    .eq("id", policyId)
    .select("*")
    .single();

  if (error) throw new Error(error.message);
  return data as Policy;
}

export async function deletePolicy(policyId: string): Promise<void> {
  if (isMissingSupabase()) {
    fallbackWarn("deletePolicy (local fallback)");
    return;
  }

  const { error } = await client().from("policies").delete().eq("id", policyId);
  if (error) throw new Error(error.message);
}

export async function approvePolicy(
  policyId: string,
  nextStatus: NonNullable<Policy["approval_status"]> = "approved"
): Promise<Policy> {
  return updatePolicy(policyId, { approval_status: nextStatus });
}

// Distributor training
export type TrainingModule = {
  id?: string;
  training_id?: string | null;
  title?: string | null;
  content?: string | null;
  approval_status?: "pending" | "approved" | "rejected" | null;
  created_at?: string | null;
};

export async function getTraining(): Promise<Record<string, unknown>[]> {
  if (isMissingSupabase()) return [];
  const rows = await safeSelect<Record<string, unknown>>(async () => {
    const { data, error } = await client()
      .from("distributor_training")
      .select("*")
      .eq("approval_status", "approved")
      .order("created_at", { ascending: false });

    return { data: (data as Record<string, unknown>[] | null) ?? null, error };
  }, "getTraining");

  return rows;
}

export async function getTrainingForManager(): Promise<TrainingModule[]> {
  if (isMissingSupabase()) return [];
  const rows = await safeSelect<TrainingModule>(async () => {
    const { data, error } = await client()
      .from("distributor_training")
      .select("*")
      .order("created_at", { ascending: false });
    return { data: (data as TrainingModule[] | null) ?? null, error };
  }, "getTrainingForManager");

  return rows;
}

export async function createTraining(input: {
  training_id?: string | null;
  title: string;
  content: string;
  approval_status?: TrainingModule["approval_status"];
}): Promise<TrainingModule> {
  if (isMissingSupabase()) {
    fallbackWarn("createTraining (local fallback)");
    return {
      id: "demo-training-created",
      training_id: input.training_id ?? null,
      title: input.title,
      content: input.content,
      approval_status: input.approval_status ?? "pending",
      created_at: new Date().toISOString(),
    };
  }

  const { data, error } = await client()
    .from("distributor_training")
    .insert([
      {
        training_id: input.training_id ?? null,
        title: input.title,
        content: input.content,
        approval_status: input.approval_status ?? "pending",
      },
    ])
    .select("*")
    .single();

  if (error) throw new Error(error.message);
  return data as TrainingModule;
}

export async function updateTraining(
  trainingRowId: string,
  patch: Partial<Pick<TrainingModule, "training_id" | "title" | "content" | "approval_status">>
): Promise<TrainingModule> {
  if (isMissingSupabase()) {
    fallbackWarn("updateTraining (local fallback)");
    return {
      id: trainingRowId,
      training_id: patch.training_id ?? null,
      title: patch.title ?? "Demo Module",
      content: patch.content ?? "Demo content",
      approval_status: patch.approval_status ?? "pending",
      created_at: new Date().toISOString(),
    };
  }

  const { data, error } = await client()
    .from("distributor_training")
    .update({
      training_id: patch.training_id ?? undefined,
      title: patch.title ?? undefined,
      content: patch.content ?? undefined,
      approval_status: patch.approval_status ?? undefined,
    })
    .eq("id", trainingRowId)
    .select("*")
    .single();

  if (error) throw new Error(error.message);
  return data as TrainingModule;
}

export async function deleteTraining(trainingRowId: string): Promise<void> {
  if (isMissingSupabase()) {
    fallbackWarn("deleteTraining (local fallback)");
    return;
  }

  const { error } = await client()
    .from("distributor_training")
    .delete()
    .eq("id", trainingRowId);

  if (error) throw new Error(error.message);
}

export async function approveTraining(
  trainingRowId: string,
  nextStatus: NonNullable<TrainingModule["approval_status"]> = "approved"
): Promise<TrainingModule> {
  return updateTraining(trainingRowId, { approval_status: nextStatus });
}

// Objection handling
export async function getObjectionHandling(): Promise<Record<string, unknown>[]> {
  if (isMissingSupabase()) return [];
  const rows = await safeSelect<Record<string, unknown>>(async () => {
    const { data, error } = await client()
      .from("objection_handling")
      .select("*")
      .eq("approval_status", "approved")
      .order("created_at", { ascending: false });

    return { data: (data as Record<string, unknown>[] | null) ?? null, error };
  }, "getObjectionHandling");

  return rows;
}

// Social templates
export async function getSocialTemplates(): Promise<Record<string, unknown>[]> {
  if (isMissingSupabase()) return [];
  const rows = await safeSelect<Record<string, unknown>>(async () => {
    const { data, error } = await client()
      .from("social_templates")
      .select("*")
      .eq("approval_status", "approved")
      .order("created_at", { ascending: false });

    return { data: (data as Record<string, unknown>[] | null) ?? null, error };
  }, "getSocialTemplates");

  return rows;
}

// Leads
export async function getLeads(): Promise<Lead[]> {
  if (isMissingSupabase()) return mapDemoLeads();

  const rows = await safeSelect<Lead>(async () => {
    const { data, error } = await client()
      .from("leads")
      .select("*")
      .order("created_at", { ascending: false });

    return { data: (data as Lead[] | null) ?? null, error };
  }, "getLeads");

  return rows.length ? rows : mapDemoLeads();
}

export async function addLead(lead: Lead): Promise<unknown> {
  if (isMissingSupabase()) {
    // Safe mock success: store locally so UI can behave as if inserted.
    try {
      const key = "dayjoy_leads_demo_fallback";
      const existingRaw = window.localStorage.getItem(key);
      const existing = existingRaw ? (JSON.parse(existingRaw) as Lead[]) : [];
      existing.unshift({ ...lead, created_at: new Date().toISOString() });
      window.localStorage.setItem(key, JSON.stringify(existing.slice(0, 200)));
    } catch {
      // ignore
    }
    fallbackWarn("addLead (local fallback)");
    return [{ ...lead }];
  }

  try {
    const { data, error } = await client()
      .from("leads")
      .insert([lead])
      .select();

    if (error) throw new Error(error.message);
    return data;
  } catch (err) {
    fallbackWarn("addLead (db failed, local fallback)", err);
    try {
      const key = "dayjoy_leads_demo_fallback";
      const existingRaw = window.localStorage.getItem(key);
      const existing = existingRaw ? (JSON.parse(existingRaw) as Lead[]) : [];
      existing.unshift({ ...lead, created_at: new Date().toISOString() });
      window.localStorage.setItem(key, JSON.stringify(existing.slice(0, 200)));
    } catch {
      // ignore
    }
    return [{ ...lead }];
  }
}

// Analytics
export async function logAnalytics(event: AnalyticsEvent): Promise<unknown> {
  if (isMissingSupabase()) {
    fallbackWarn("logAnalytics (no supabase configured)");
    return [{ ...event }];
  }

  try {
    const { data, error } = await client()
      .from("analytics")
      .insert([event])
      .select();

    if (error) throw new Error(error.message);
    return data;
  } catch (err) {
    fallbackWarn("logAnalytics (db failed)", err);
    return null;
  }
}

export async function getAnalytics(): Promise<AnalyticsEvent[]> {
  if (isMissingSupabase()) return [];

  const rows = await safeSelect<AnalyticsEvent>(async () => {
    const { data, error } = await client()
      .from("analytics")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(500);

    return { data: (data as AnalyticsEvent[] | null) ?? null, error };
  }, "getAnalytics");

  return rows;
}

/**
 * Keep existing demoData.ts exports unused but referenced for fallback compatibility.
 * documents/tickets are here so bundlers don't tree-shake and to signal future expansion.
 */
void demoDocuments;
void demoTickets;
