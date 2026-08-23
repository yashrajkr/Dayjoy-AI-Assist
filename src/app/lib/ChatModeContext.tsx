import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { type AiMode, isAiMode } from "./aiModes";

const STORAGE_KEY = "dayjoy-ai-mode";
const DEFAULT_MODE: AiMode = "normal";

function readStoredMode(): AiMode {
  if (typeof window === "undefined") return DEFAULT_MODE;
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return isAiMode(stored) ? stored : DEFAULT_MODE;
}

interface ChatModeContextValue {
  mode: AiMode;
  setMode: (mode: AiMode) => void;
}

const ChatModeContext = createContext<ChatModeContextValue>({
  mode: DEFAULT_MODE,
  setMode: () => {},
});

/**
 * Selected AI mode (Normal/Thinking/Deep Research/Compare Products) — a
 * browser-level preference like ChatExperienceContext's Professional/Explorer
 * toggle, persisted across reloads. Sent as `ai_mode` on every chat request;
 * a conversation's already-sent messages keep whatever mode they were
 * answered with (stored per-message), independent of later mode switches.
 */
export function ChatModeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<AiMode>(readStoredMode);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, mode);
  }, [mode]);

  const setMode = useCallback((next: AiMode) => setModeState(next), []);

  const value = useMemo(() => ({ mode, setMode }), [mode, setMode]);

  return <ChatModeContext.Provider value={value}>{children}</ChatModeContext.Provider>;
}

export function useChatMode() {
  return useContext(ChatModeContext);
}
