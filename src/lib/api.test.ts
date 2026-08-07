import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateConversationTitle } from "./api";

/**
 * generateConversationTitle() calls the existing backend /chat/title
 * endpoint and is designed to be best-effort: any failure (network error,
 * non-2xx, malformed body) resolves to null so callers keep their own
 * deterministic fallback rather than surfacing an error to the user.
 *
 * No VITE_SUPABASE_URL is set in the test env, so the Supabase client is
 * unconfigured and requests go out without an Authorization header — that
 * mirrors demo mode and keeps these tests independent of Supabase.
 */
describe("generateConversationTitle", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.useRealTimers();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("returns the trimmed title on a successful response", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ title: "  Vapi Backend Integration  " }),
    }) as unknown as typeof fetch;

    const title = await generateConversationTitle("How can I integrate Vapi with my Dayjoy backend?");
    expect(title).toBe("Vapi Backend Integration");
  });

  it("posts to /chat/title with the message body", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ title: "Distributor Commission Tracking" }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await generateConversationTitle("Help me design the distributor commission system.");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/chat/title");
    expect(JSON.parse(options.body)).toEqual({
      message: "Help me design the distributor commission system.",
    });
  });

  it("returns null when the backend responds with a non-2xx status", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 }) as unknown as typeof fetch;
    const title = await generateConversationTitle("Some question");
    expect(title).toBeNull();
  });

  it("returns null when the response has an empty/missing title", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ title: "" }),
    }) as unknown as typeof fetch;
    expect(await generateConversationTitle("Some question")).toBeNull();

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    }) as unknown as typeof fetch;
    expect(await generateConversationTitle("Some question")).toBeNull();
  });

  it("returns null instead of throwing on a network failure", async () => {
    global.fetch = vi.fn().mockRejectedValue(new TypeError("Failed to fetch")) as unknown as typeof fetch;
    await expect(generateConversationTitle("Some question")).resolves.toBeNull();
  });

  it("returns null instead of throwing on malformed JSON", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => {
        throw new SyntaxError("Unexpected token");
      },
    }) as unknown as typeof fetch;
    await expect(generateConversationTitle("Some question")).resolves.toBeNull();
  });

  it("returns null when the request times out", async () => {
    global.fetch = vi.fn().mockImplementation(
      () =>
        new Promise((_, reject) => {
          reject(new DOMException("The operation was aborted.", "TimeoutError"));
        }),
    ) as unknown as typeof fetch;
    await expect(generateConversationTitle("Some question")).resolves.toBeNull();
  });
});
