/**
 * Dayjoy AI Assist — i18n system
 *
 * Lightweight translation registry. Supports English + Hindi out of the box.
 * New languages (Marathi, Gujarati, Tamil, Telugu, Punjabi) can be added by
 * dropping a new file in `locales/` and registering it here — no code changes
 * needed elsewhere.
 *
 * Persistence: the selected language is stored in localStorage under
 * `dayjoy_language` and synced to the Supabase `profiles.language` column
 * when the user is signed in.
 *
 * Backend integration: the selected language is forwarded to `/chat` as
 * `req.language` so the LLM responds in the right language.
 */

export type LanguageCode = "en" | "hi";

export const LANGUAGES: { code: LanguageCode; label: string; nativeLabel: string }[] = [
  { code: "en", label: "English", nativeLabel: "English" },
  { code: "hi", label: "Hindi", nativeLabel: "हिन्दी" },
  // Future: marathi, gujarati, tamil, telugu, punjabi — just add a locale file
];

export type TranslationKey =
  | "app.name"
  | "app.tagline"
  | "app.description"
  | "nav.chat"
  | "nav.products"
  | "nav.distributor"
  | "nav.support"
  | "nav.settings"
  | "nav.signOut"
  | "nav.admin"
  | "chat.welcome"
  | "chat.placeholder"
  | "chat.send"
  | "chat.stop"
  | "chat.thinking"
  | "chat.searching"
  | "chat.sources"
  | "chat.confidence"
  | "chat.handoff"
  | "chat.newConversation"
  | "chat.searchConversations"
  | "chat.empty.title"
  | "chat.empty.description"
  | "common.loading"
  | "common.save"
  | "common.cancel"
  | "common.delete"
  | "common.approve"
  | "common.reject"
  | "common.search"
  | "common.refresh"
  | "common.export"
  | "common.close"
  | "login.title"
  | "login.tagline"
  | "login.email"
  | "login.password"
  | "login.fullName"
  | "login.role"
  | "login.login"
  | "login.signup"
  | "login.createAccount"
  | "login.accountCreated"
  | "login.invalidCredentials"
  | "login.demoMode"
  | "support.title"
  | "support.query"
  | "support.category"
  | "support.priority"
  | "support.submit"
  | "support.submitted"
  | "products.title"
  | "products.search"
  | "products.compare"
  | "products.details"
  | "training.title"
  | "training.progress"
  | "training.complete"
  | "training.certificate"
  | "admin.dashboard"
  | "admin.users"
  | "admin.analytics"
  | "admin.audit"
  | "admin.knowledge"
  | "admin.approvals";

export type TranslationMap = Partial<Record<TranslationKey, string>>;
