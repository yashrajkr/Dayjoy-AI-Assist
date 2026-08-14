import { useCallback, useEffect, useState } from "react";

export type ChatExperience = "professional" | "explorer";

const LS_KEY = "dayjoy_chat_experience";
const EVENT = "dayjoy:chat-experience-change";

export function getChatExperience(): ChatExperience {
  const raw = window.localStorage.getItem(LS_KEY);
  return raw === "explorer" ? "explorer" : "professional";
}

export function setChatExperience(mode: ChatExperience): void {
  window.localStorage.setItem(LS_KEY, mode);
  window.dispatchEvent(new CustomEvent(EVENT, { detail: mode }));
}

/**
 * Chat Experience preference — "Professional" (default) keeps the mobile
 * chat screen minimal (no quick-question cards, no bottom tab bar);
 * "Explorer" restores the full discovery-oriented layout. Cross-tab/
 * same-tab reactive via a custom event since plain localStorage writes
 * don't fire `storage` events in the tab that made them.
 */
export function useChatExperience(): [ChatExperience, (mode: ChatExperience) => void] {
  const [mode, setMode] = useState<ChatExperience>(() => getChatExperience());

  useEffect(() => {
    function onChange(e: Event) {
      setMode((e as CustomEvent<ChatExperience>).detail);
    }
    window.addEventListener(EVENT, onChange);
    return () => window.removeEventListener(EVENT, onChange);
  }, []);

  const update = useCallback((next: ChatExperience) => {
    setChatExperience(next);
    setMode(next);
  }, []);

  return [mode, update];
}
