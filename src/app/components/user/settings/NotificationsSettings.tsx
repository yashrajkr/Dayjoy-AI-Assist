import { useCallback, useEffect, useState } from "react";
import {
  Bell,
  BellRing,
  BellOff,
  Smartphone,
  AlertCircle,
  Check,
  CheckCircle2,
} from "lucide-react";
import { BRAND } from "../../../lib/brand";
import { Button } from "../../ui/button";
import {
  getPushSubscriptionState,
  subscribeToPush,
  unsubscribeFromPush,
  sendLocalNotification,
  type PushSubscriptionState,
} from "../../../lib/pushNotifications";
import { SettingsDetailShell, SettingsSection, SettingsRow, SettingsHint } from "./SettingsUI";

const LS_NOTIFICATIONS_KEY = "dayjoy_user_notifications";

export function NotificationsSettings() {
  const [notifications, setNotifications] = useState(true);

  const [pushState, setPushState] = useState<PushSubscriptionState | null>(null);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushMessage, setPushMessage] = useState<string | null>(null);

  const refreshPushState = useCallback(async () => {
    const s = await getPushSubscriptionState();
    setPushState(s);
  }, []);

  useEffect(() => {
    const raw = window.localStorage.getItem(LS_NOTIFICATIONS_KEY);
    setNotifications(raw !== "false");
    refreshPushState();
  }, [refreshPushState]);

  const toggleInApp = () => {
    setNotifications((v) => {
      const next = !v;
      window.localStorage.setItem(LS_NOTIFICATIONS_KEY, String(next));
      return next;
    });
  };

  const handleEnablePush = useCallback(async () => {
    setPushBusy(true);
    setPushMessage(null);
    const ok = await subscribeToPush();
    await refreshPushState();
    setPushMessage(ok ? "Push notifications enabled." : "Permission denied. Enable notifications in your browser settings.");
    setTimeout(() => setPushMessage(null), 3500);
    setPushBusy(false);
    if (ok) {
      setTimeout(() => {
        sendLocalNotification({
          title: `${BRAND.shortName} notifications are on`,
          body: "You'll be notified about ticket updates, training reminders, and AI completions.",
          tag: "welcome-push",
          route: "/",
        });
      }, 800);
    }
  }, [refreshPushState]);

  const handleDisablePush = useCallback(() => {
    unsubscribeFromPush();
    refreshPushState();
    setPushMessage("Push notifications disabled.");
    setTimeout(() => setPushMessage(null), 2500);
  }, [refreshPushState]);

  const handleTestPush = useCallback(() => {
    sendLocalNotification({
      title: "Test notification",
      body: `This is how ${BRAND.shortName} notifications appear.`,
      tag: "test-push",
      route: "/settings/notifications",
    });
  }, []);

  return (
    <SettingsDetailShell title="Notifications" subtitle="In-app and device alerts" icon={Bell}>
      <SettingsSection label="In-app">
        <SettingsRow
          icon={Bell}
          label="In-app notifications"
          description="Ticket updates and new training assignments"
          value={notifications ? "On" : "Off"}
          onClick={toggleInApp}
          chevron={false}
        />
      </SettingsSection>

      <div>
        <h2 className="px-1 mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Push notifications
        </h2>
        <div className="rounded-xl border border-border bg-card p-3.5 space-y-3">
          <SettingsHint>
            Get OS-level notifications on this device when tickets update, training is assigned, or AI responses
            finish — even when {BRAND.shortName} is in the background.
          </SettingsHint>

          <div className="flex items-center gap-2 text-xs flex-wrap">
            {pushState ? (
              <>
                <span
                  className={`inline-flex items-center gap-1 px-2 py-1 rounded-full ${
                    pushState.subscribed
                      ? "bg-primary/10 text-primary"
                      : pushState.permission === "denied"
                        ? "bg-destructive/10 text-destructive"
                        : "bg-muted text-muted-foreground"
                  }`}
                >
                  {pushState.subscribed ? (
                    <>
                      <Check className="w-3 h-3" aria-hidden="true" /> Subscribed
                    </>
                  ) : pushState.permission === "denied" ? (
                    <>
                      <AlertCircle className="w-3 h-3" aria-hidden="true" /> Blocked
                    </>
                  ) : (
                    <>
                      <BellOff className="w-3 h-3" aria-hidden="true" /> Not subscribed
                    </>
                  )}
                </span>
                <span className="text-muted-foreground">
                  Permission: <span className="font-mono">{pushState.permission}</span>
                </span>
                {pushState.swRegistered ? (
                  <span className="inline-flex items-center gap-1 text-muted-foreground">
                    <Smartphone className="w-3 h-3" aria-hidden="true" /> SW ready
                  </span>
                ) : null}
              </>
            ) : (
              <span className="text-muted-foreground">Checking…</span>
            )}
          </div>

          {pushState && !pushState.supported ? (
            <div className="rounded-lg border border-warning/30 bg-warning/5 p-2.5 text-xs text-warning flex items-start gap-2">
              <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />
              <span>
                Push notifications aren't supported in this browser. On iOS, install {BRAND.shortName} to your home
                screen first.
              </span>
            </div>
          ) : null}

          {pushState && pushState.permission === "denied" ? (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-2.5 text-xs text-destructive flex items-start gap-2">
              <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />
              <span>
                Notifications are blocked at the browser level. Open site settings (lock icon in URL bar) and allow
                notifications to re-enable.
              </span>
            </div>
          ) : null}

          <div className="flex items-center gap-2 flex-wrap">
            {pushState && !pushState.subscribed ? (
              <Button type="button" onClick={handleEnablePush} disabled={pushBusy || !pushState.supported}>
                <BellRing className="w-4 h-4" aria-hidden="true" />
                {pushBusy ? "Requesting…" : "Enable push"}
              </Button>
            ) : null}
            {pushState && pushState.subscribed ? (
              <>
                <Button type="button" variant="secondary" onClick={handleTestPush}>
                  <Bell className="w-4 h-4" aria-hidden="true" />
                  Send test
                </Button>
                <Button type="button" variant="ghost" onClick={handleDisablePush}>
                  <BellOff className="w-4 h-4" aria-hidden="true" />
                  Disable
                </Button>
              </>
            ) : null}
          </div>

          {pushMessage ? (
            <p className="text-xs text-primary flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
              {pushMessage}
            </p>
          ) : null}
        </div>
      </div>
    </SettingsDetailShell>
  );
}
