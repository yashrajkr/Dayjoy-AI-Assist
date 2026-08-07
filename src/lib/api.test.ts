import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateConversationTitle, streamChatWithBackend } from "./api";

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

/**
 * streamChatWithBackend() parses the backend's SSE frames into a single
 * ChatResponse. This covers the AI router labeling fields (answer_source,
 * web_search_provider) added to the final "done" frame — additive fields
 * that must survive the SSE parse -> ChatResponse mapping unchanged.
 */
describe("streamChatWithBackend — answer_source passthrough", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  /** Builds a fake SSE response body from a list of already-formatted frames. */
  function makeSSEBody(frames: string[]) {
    let i = 0;
    return {
      getReader() {
        return {
          async read() {
            if (i < frames.length) {
              const chunk = new TextEncoder().encode(frames[i]);
              i += 1;
              return { done: false, value: chunk };
            }
            return { done: true, value: undefined };
          },
        };
      },
    };
  }

  it("carries answer_source and web_search_provider through to the returned ChatResponse", async () => {
    const tokenFrame = `data: ${JSON.stringify({ token: "The answer" })}\n\n`;
    const doneFrame = `data: ${JSON.stringify({
      done: true,
      category: "product",
      sources: [],
      safety_status: "safe",
      handoff_required: false,
      confidence: 0.9,
      conversation_id: "conv-1",
      verification_status: "verified",
      answer_source: "hybrid",
      web_search_provider: "brave",
    })}\n\n`;

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      body: makeSSEBody([tokenFrame, doneFrame]),
    }) as unknown as typeof fetch;

    const result = await streamChatWithBackend(
      { message: "Compare Dayjoy Spirulina with other brands", role: "customer", language: "English" },
      () => {},
    );

    expect(result.answer_source).toBe("hybrid");
    expect(result.web_search_provider).toBe("brave");
  });

  it("defaults answer_source to undefined when the backend omits it (older backend / no route computed)", async () => {
    const doneFrame = `data: ${JSON.stringify({
      done: true,
      category: "general",
      sources: [],
      safety_status: "safe",
      handoff_required: false,
    })}\n\n`;

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      body: makeSSEBody([doneFrame]),
    }) as unknown as typeof fetch;

    const result = await streamChatWithBackend(
      { message: "hi", role: "customer", language: "English" },
      () => {},
    );

    expect(result.answer_source).toBeUndefined();
    expect(result.web_search_provider).toBeUndefined();
  });
});
