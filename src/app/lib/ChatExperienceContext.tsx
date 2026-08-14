import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type ChatExperienceMode = "professional" | "explorer";

const STORAGE_KEY = "dayjoy-chat-experience";
const DEFAULT_MODE: ChatExperienceMode = "professional";

function readStoredMode(): ChatExperienceMode {
  if (typeof window === "undefined") return DEFAULT_MODE;
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return stored === "explorer" ? "explorer" : DEFAULT_MODE;
}

interface ChatExperienceContextValue {
  mode: ChatExperienceMode;
  setMode: (mode: ChatExperienceMode) => void;
}

const ChatExperienceContext = createContext<ChatExperienceContextValue>({
  mode: DEFAULT_MODE,
  setMode: () => {},
});

/**
 * Controls whether the mobile app shows the minimal "Professional" chat-first
 * shell (default) or the older feature-dense "Explorer" shell with quick
 * prompts, the mobile bottom tab bar, and inline header controls. Desktop is
 * unaffected either way — this only changes what's rendered below the `lg`
 * breakpoint. Persisted so the choice survives reloads/PWA reopen.
 */
export function ChatExperienceProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ChatExperienceMode>(readStoredMode);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, mode);
  }, [mode]);

  const setMode = useCallback((next: ChatExperienceMode) => setModeState(next), []);

  const value = useMemo(() => ({ mode, setMode }), [mode, setMode]);

  return <ChatExperienceContext.Provider value={value}>{children}</ChatExperienceContext.Provider>;
}

export function useChatExperience() {
  return useContext(ChatExperienceContext);
}
