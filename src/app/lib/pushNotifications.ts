/**
 * Push Notifications — Browser Notification API + Service Worker bridge.
 *
 * This module provides a typed wrapper around the Web Notifications API
 * and the Service Worker push event pipeline. It is designed to gracefully
 * degrade on browsers that lack support (Firefox without SW, iOS Safari
 * without PWA install) and to surface clear status flags to the UI.
 *
 * CAPABILITIES (all client-side, no FCM server key required):
 *   - Permission request + status query
 *   - Local notification dispatch via Notification API (active tab)
 *   - Service Worker notification dispatch (background/hidden tab)
 *   - Notification click → focus tab + optional route navigation
 *   - Subscription persistence (so we know whether user opted in)
 *
 * WHY NO FCM: We deliberately avoid the FCM VAPID push pipeline because
 * it requires a backend sender key + endpoint registration. For an
 * enterprise assistant whose notifications are largely user-initiated
 * (ticket updates, training reminders, AI completions), the local
 * Service Worker path covers ~95% of needs. A future iteration can
 * swap in FCM by adding `subscribePush()` alongside the existing API.
 *
 * SECURITY:
 *   - No PII in notification bodies (titles only).
 *   - Permission state is never bypassed — `requestPermission` is the
 *     only entry point and it can only be triggered by a user gesture.
 *   - Subscription state is persisted to localStorage so refreshes
 *     don't lose opt-in. The actual permission lives with the browser.
 */

const LS_SUBSCRIPTION_KEY = "dayjoy_push_subscribed";
const LS_NOTIFICATIONS_ENABLED_KEY = "dayjoy_user_notifications";

export type NotificationPermissionState = "granted" | "denied" | "default" | "unsupported";

export type PushSubscriptionState = {
  /** User has explicitly opted in AND browser has granted permission. */
  subscribed: boolean;
  /** Underlying browser permission state. */
  permission: NotificationPermissionState;
  /** Whether the Notifications API exists in this browser. */
  supported: boolean;
  /** Whether a Service Worker registration is available. */
  swRegistered: boolean;
};

export type DayjoyNotificationPayload = {
  title: string;
  body?: string;
  /** Icon shown in the notification — defaults to Dayjoy mark. */
  icon?: string;
  /** Route to navigate to on click, e.g. "/support". */
  route?: string;
  /** Optional tag for grouping/replacement. */
  tag?: string;
  /** Optional timestamp; defaults to now. */
  timestamp?: number;
};

/** Default notification icon — inline SVG data URL of the Dayjoy mark. */
const DEFAULT_ICON =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='14' fill='%23234F1E'/%3E%3Cpath d='M32 14c-9.4 0-17 7.4-17 16.6 0 5.2 2.4 9.8 6.2 12.9V48l5.4-3c1.7.4 3.5.6 5.4.6 9.4 0 17-7.4 17-16.6S41.4 14 32 14z' fill='%23FFFFFF'/%3E%3C/svg%3E";

/**
 * Detect whether the browser supports the Web Notifications API.
 * Returns false on iOS Safari without standalone mode (PWA install).
 */
export function isNotificationSupported(): boolean {
  if (typeof window === "undefined") return false;
  if (!("Notification" in window)) return false;
  // iOS Safari only shows notifications when running as installed PWA.
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const isStandalone =
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true;
  if (isIOS && !isStandalone) return false;
  return true;
}

/**
 * Detect whether service workers are registered/available.
 */
export async function isServiceWorkerRegistered(): Promise<boolean> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return false;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    return !!reg;
  } catch {
    return false;
  }
}

/**
 * Get the current permission state of the Notifications API.
 */
export function getPermissionState(): NotificationPermissionState {
  if (!isNotificationSupported()) return "unsupported";
  // Notification.permission: "granted" | "denied" | "default"
  const p = Notification.permission;
  if (p === "granted") return "granted";
  if (p === "denied") return "denied";
  return "default";
}

/**
 * Request permission to show notifications. MUST be called from a user
 * gesture (button click) — browsers block programmatic requests.
 *
 * Returns the resulting permission state. If the user denies, we also
 * clear the local subscription flag so the UI reflects the truth.
 */
export async function requestNotificationPermission(): Promise<NotificationPermissionState> {
  if (!isNotificationSupported()) return "unsupported";
  try {
    const result = await Notification.requestPermission();
    if (result !== "granted") {
      window.localStorage.setItem(LS_SUBSCRIPTION_KEY, "false");
    }
    return result === "granted" ? "granted" : result === "denied" ? "denied" : "default";
  } catch {
    return "denied";
  }
}

/**
 * Read the full subscription state. UI consumers should call this on
 * mount to render the correct opt-in/opt-out affordance.
 */
export async function getPushSubscriptionState(): Promise<PushSubscriptionState> {
  const supported = isNotificationSupported();
  const permission = getPermissionState();
  const swRegistered = await isServiceWorkerRegistered();
  const rawFlag = window.localStorage.getItem(LS_SUBSCRIPTION_KEY);
  const optedIn = rawFlag === "true";
  const subscribed = supported && permission === "granted" && optedIn;
  return { subscribed, permission, supported, swRegistered };
}

/**
 * Opt in to push notifications. Requests permission if not yet granted,
 * then persists the opt-in flag. If permission is denied, returns false.
 */
export async function subscribeToPush(): Promise<boolean> {
  if (!isNotificationSupported()) return false;
  const permission = await requestNotificationPermission();
  if (permission !== "granted") return false;
  window.localStorage.setItem(LS_SUBSCRIPTION_KEY, "true");
  window.localStorage.setItem(LS_NOTIFICATIONS_ENABLED_KEY, "true");
  return true;
}

/**
 * Opt out of push notifications. Clears the local flag but does NOT
 * revoke browser permission (the user controls that via browser settings).
 * We intentionally don't revoke because re-requesting permission is
 * subject to browser anti-spam rules.
 */
export function unsubscribeFromPush(): void {
  window.localStorage.setItem(LS_SUBSCRIPTION_KEY, "false");
}

/**
 * Dispatch a local notification. Routes through the Service Worker when
 * available (so the notification shows even if the tab is hidden),
 * falling back to the direct Notification constructor otherwise.
 *
 * On click, the notification focuses the originating window and
 * optionally navigates to the supplied route.
 */
export async function sendLocalNotification(payload: DayjoyNotificationPayload): Promise<boolean> {
  if (!isNotificationSupported()) return false;
  if (getPermissionState() !== "granted") return false;

  const icon = payload.icon ?? DEFAULT_ICON;
  const tag = payload.tag ?? "dayjoy-default";
  const timestamp = payload.timestamp ?? Date.now();
  const body = payload.body ?? "";
  const route = payload.route;

  // Try Service Worker path (works when tab is hidden/backgrounded).
  try {
    if ("serviceWorker" in navigator) {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg) {
        await reg.showNotification(payload.title, {
          body,
          icon,
          tag,
          data: { route, timestamp },
          badge: icon,
        } as NotificationOptions);
        return true;
      }
    }
  } catch {
    // Fall through to direct Notification constructor.
  }

  // Fallback: direct Notification (only reliable when tab is focused).
  try {
    const n = new Notification(payload.title, {
      body,
      icon,
      tag,
      data: { route, timestamp },
    } as NotificationOptions);
    n.onclick = () => {
      window.focus();
      if (route) {
        window.location.hash = "";
        window.location.assign(route);
      }
      n.close();
    };
    return true;
  } catch {
    return false;
  }
}

/**
 * Wire up the notification click handler on the active Service Worker.
 * Call this once at app startup. When a notification is clicked, the SW
 * posts a message back to the client; this listener forwards it to the
 * supplied callback (e.g. navigate via react-router).
 *
 * Returns an unsubscribe function.
 */
export function subscribeToNotificationClicks(
  onNavigate: (route: string) => void,
): () => void {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return () => undefined;
  }
  const handler = (event: MessageEvent) => {
    const data = event.data as { type?: string; route?: string } | null;
    if (data?.type === "NOTIFICATION_CLICK" && data.route) {
      onNavigate(data.route);
    }
  };
  navigator.serviceWorker.addEventListener("message", handler);
  return () => navigator.serviceWorker.removeEventListener("message", handler);
}

/**
 * Convenience helper: send a "support ticket updated" notification.
 */
export function notifyTicketUpdate(ticketId: string, status: string): Promise<boolean> {
  return sendLocalNotification({
    title: "Support ticket updated",
    body: `Ticket #${ticketId.slice(0, 8)} is now ${status}.`,
    route: "/support",
    tag: `ticket-${ticketId}`,
  });
}

/**
 * Convenience helper: send a "training assigned" notification.
 */
export function notifyTrainingAssigned(moduleName: string): Promise<boolean> {
  return sendLocalNotification({
    title: "New training assigned",
    body: `${moduleName} is ready to start.`,
    route: "/training",
    tag: "training-new",
  });
}

/**
 * Convenience helper: send a "AI response ready" notification.
 * Useful when a long RAG query finishes after the user switched tabs.
 */
export function notifyAIResponseReady(): Promise<boolean> {
  return sendLocalNotification({
    title: "AI response ready",
    body: "Your Dayjoy AI response is ready to view.",
    route: "/",
    tag: "ai-response",
  });
}
