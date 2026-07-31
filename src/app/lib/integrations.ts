/**
 * Integration Interface — typed abstraction for external integrations.
 *
 * This module provides a unified interface for sending messages, syncing
 * calendars, and exchanging files with external services (WhatsApp, Email,
 * Google Drive, Slack, etc.).
 *
 * SECURITY:
 *   - No credentials are stored in frontend code or localStorage.
 *   - All integration calls go through the FastAPI backend, which reads
 *     credentials from environment variables.
 *   - The frontend only specifies WHICH integration to use and the payload.
 *
 * ARCHITECTURE:
 *   Frontend → POST /api/integrations/{key}/send → Backend reads .env → External API
 *
 * To add a new integration:
 *   1. Add a row to `integration_configs` table (via admin UI or SQL seed)
 *   2. Add the corresponding env vars to backend/.env (e.g. WHATSAPP_TOKEN)
 *   3. Implement the backend handler in backend/integrations/{key}.py
 *   4. The frontend automatically picks up the new integration via this interface
 */

export type IntegrationKey =
  | "whatsapp"
  | "email"
  | "google_drive"
  | "google_calendar"
  | "slack"
  | "webhook"
  | string;

export type IntegrationCategory =
  | "communication"
  | "storage"
  | "calendar"
  | "crm"
  | "erp"
  | "webhook"
  | "other";

export type IntegrationConfig = {
  integration_key: IntegrationKey;
  display_name: string;
  description: string | null;
  category: IntegrationCategory;
  enabled: boolean;
  webhook_url: string | null;
};

export type SendMessageParams = {
  to: string;
  subject?: string;
  body: string;
  attachments?: Array<{ filename: string; url: string }>;
};

export type SyncEventParams = {
  title: string;
  start_time: string;
  end_time: string;
  description?: string;
  attendees?: string[];
};

export type FileOperationParams = {
  filename: string;
  content?: string;
  url?: string;
  folder?: string;
};

export type WebhookPayload = {
  event: string;
  entity_type: string;
  entity_id: string;
  data: Record<string, unknown>;
};

/**
 * Send a message via the specified integration (WhatsApp, Email, Slack).
 * The backend resolves credentials from env vars — none are passed from the frontend.
 */
export async function sendIntegrationMessage(
  key: IntegrationKey,
  params: SendMessageParams,
): Promise<{ success: boolean; message_id?: string; error?: string }> {
  const apiUrl = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8000";
  try {
    const res = await fetch(`${apiUrl}/integrations/${key}/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { success: false, error: `${res.status}: ${text.slice(0, 200)}` };
    }
    return await res.json();
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : "Network error",
    };
  }
}

/**
 * Sync an event to a calendar integration (Google Calendar).
 */
export async function syncIntegrationEvent(
  key: IntegrationKey,
  params: SyncEventParams,
): Promise<{ success: boolean; event_id?: string; error?: string }> {
  const apiUrl = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8000";
  try {
    const res = await fetch(`${apiUrl}/integrations/${key}/sync-event`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });
    if (!res.ok) {
      return { success: false, error: `${res.status}` };
    }
    return await res.json();
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : "Network error",
    };
  }
}

/**
 * Upload or fetch a file via a storage integration (Google Drive).
 */
export async function integrationFileOp(
  key: IntegrationKey,
  operation: "upload" | "fetch",
  params: FileOperationParams,
): Promise<{ success: boolean; file_url?: string; error?: string }> {
  const apiUrl = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8000";
  try {
    const res = await fetch(`${apiUrl}/integrations/${key}/file`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ operation, ...params }),
    });
    if (!res.ok) {
      return { success: false, error: `${res.status}` };
    }
    return await res.json();
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : "Network error",
    };
  }
}

/**
 * Fire a webhook to an external system.
 */
export async function fireWebhook(
  payload: WebhookPayload,
): Promise<{ success: boolean; error?: string }> {
  const apiUrl = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8000";
  try {
    const res = await fetch(`${apiUrl}/integrations/webhook/fire`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      return { success: false, error: `${res.status}` };
    }
    return { success: true };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : "Network error",
    };
  }
}

/**
 * CSV import — upload a CSV file for bulk product/FAQ import.
 * Returns the parsed rows as JSON.
 */
export async function importCSV(
  file: File,
  entityType: "products" | "faqs" | "policies",
): Promise<{ success: boolean; rows?: Record<string, unknown>[]; error?: string }> {
  const apiUrl = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8000";
  const formData = new FormData();
  formData.append("file", file);
  formData.append("entity_type", entityType);
  try {
    const res = await fetch(`${apiUrl}/integrations/csv/import`, {
      method: "POST",
      body: formData,
    });
    if (!res.ok) {
      return { success: false, error: `${res.status}` };
    }
    return await res.json();
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : "Network error",
    };
  }
}
