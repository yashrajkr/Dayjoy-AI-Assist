import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Bell, X, CheckCircle2, AlertCircle, Info, GraduationCap } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import { useAuth } from "../../lib/AuthContext";
import { sendLocalNotification } from "../../lib/pushNotifications";

/**
 * NotificationCenter — realtime notification bell + dropdown.
 *
 * Notification sources (read from existing tables):
 *   - Support ticket updates (support_tickets where status changed)
 *   - Knowledge updates (audit_logs on knowledge entities)
 *   - Admin announcements (manual — future)
 *   - Training reminders (training_progress where status = 'in_progress')
 *   - System alerts (safety_rules changes)
 *
 * Realtime: subscribes to Supabase Realtime on `support_tickets` and
 * `audit_logs` tables. New inserts trigger a notification entry + unread
 * badge increment.
 *
 * Persistence: read/unread state is in-memory for this session. A future
 * iteration can persist to a `notifications` table.
 */

type Notification = {
  id: string;
  type: "support" | "knowledge" | "training" | "system";
  title: string;
  body: string;
  timestamp: string;
  read: boolean;
};

const TYPE_ICONS = {
  support: Bell,
  knowledge: Info,
  training: GraduationCap,
  system: AlertCircle,
} as const;

const TYPE_COLORS = {
  support: "text-primary",
  knowledge: "text-secondary",
  training: "text-gold-accent",
  system: "text-warning",
} as const;

export function NotificationCenter() {
  const { currentUser } = useAuth();
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const ref = useRef<HTMLDivElement>(null);

  const unreadCount = notifications.filter((n) => !n.read).length;

  // Load initial notifications
  const loadNotifications = useCallback(async () => {
    if (!supabase || !currentUser?.id) return;
    try {
      // Recent support ticket updates assigned to me
      const { data: tickets } = await supabase
        .from("support_tickets")
        .select("id,query,status,created_at")
        .eq("assigned_to", currentUser.id)
        .order("created_at", { ascending: false })
        .limit(3);
      const ticketNotifs: Notification[] = (tickets ?? []).map((t: { id: string; query: string | null; status: string | null; created_at: string | null }) => ({
        id: `ticket-${t.id}`,
        type: "support" as const,
        title: "Ticket update",
        body: t.query?.slice(0, 80) ?? "—",
        timestamp: t.created_at ?? new Date().toISOString(),
        read: false,
      }));

      // Recent knowledge changes (audit_logs)
      const { data: audits } = await supabase
        .from("audit_logs")
        .select("id,action,entity_type,created_at")
        .order("created_at", { ascending: false })
        .limit(3);
      const auditNotifs: Notification[] = (audits ?? []).map((a: { id: string; action: string; entity_type: string; created_at: string | null }) => ({
        id: `audit-${a.id}`,
        type: "knowledge" as const,
        title: `${a.action} on ${a.entity_type}`,
        body: "Knowledge base was updated",
        timestamp: a.created_at ?? new Date().toISOString(),
        read: false,
      }));

      // Scheduled / Proactive Assistance (Capability 33) — reminders
      // delivered via POST /reminders/check land here (the `notifications`
      // table already existed for this, just wasn't read by this
      // component yet).
      const { data: ownNotifs } = await supabase
        .from("notifications")
        .select("id,type,title,body,link,read,created_at")
        .eq("user_id", currentUser.id)
        .order("created_at", { ascending: false })
        .limit(10);
      const reminderNotifs: Notification[] = (ownNotifs ?? []).map(
        (n: { id: string; type: string; title: string; body: string | null; read: boolean | null; created_at: string | null }) => ({
          id: `notif-${n.id}`,
          type: (["support", "knowledge", "training", "system"].includes(n.type) ? n.type : "system") as Notification["type"],
          title: n.title,
          body: n.body ?? "",
          timestamp: n.created_at ?? new Date().toISOString(),
          read: !!n.read,
        }),
      );

      setNotifications(
        [...ticketNotifs, ...auditNotifs, ...reminderNotifs]
          .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
          .slice(0, 15),
      );
    } catch (e) {
      console.warn("[notifications] load failed", e);
    }
  }, [currentUser?.id]);

  useEffect(() => {
    loadNotifications();
  }, [loadNotifications]);

  // Supabase Realtime subscription
  useEffect(() => {
    if (!supabase || !currentUser?.id) return;
    const channel = supabase
      .channel("notifications")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "support_tickets" }, (payload) => {
        const t = payload.new as { id: string; query?: string; created_at?: string };
        setNotifications((prev) =>
          [
            {
              id: `ticket-${t.id}`,
              type: "support" as const,
              title: "New support ticket",
              body: t.query?.slice(0, 80) ?? "—",
              timestamp: t.created_at ?? new Date().toISOString(),
              read: false,
            },
            ...prev,
          ].slice(0, 20),
        );
        // Fire an OS-level push notification (silently ignored if not opted in)
        void sendLocalNotification({
          title: "New support ticket",
          body: t.query?.slice(0, 100) ?? "A new ticket was assigned to you.",
          tag: `ticket-${t.id}`,
          route: "/support",
        });
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "audit_logs" }, (payload) => {
        const a = payload.new as { id: string; action: string; entity_type: string; created_at: string };
        setNotifications((prev) =>
          [
            {
              id: `audit-${a.id}`,
              type: "knowledge" as const,
              title: `${a.action} on ${a.entity_type}`,
              body: "Knowledge base was updated",
              timestamp: a.created_at ?? new Date().toISOString(),
              read: false,
            },
            ...prev,
          ].slice(0, 20),
        );
        // Fire an OS-level push notification (silently ignored if not opted in)
        void sendLocalNotification({
          title: `${a.action} on ${a.entity_type}`,
          body: "Knowledge base was updated",
          tag: `audit-${a.id}`,
          route: "/admin/timeline",
        });
      })
      .subscribe();

    return () => {
      if (supabase) supabase.removeChannel(channel);
    };
  }, [currentUser?.id]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const markAllRead = () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="relative p-2 rounded-lg hover:bg-accent/50 transition-colors"
        aria-label={`Notifications (${unreadCount} unread)`}
        aria-expanded={open}
      >
        <Bell className="w-5 h-5 text-muted-foreground" aria-hidden="true" />
        {unreadCount > 0 ? (
          <motion.span
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold flex items-center justify-center"
          >
            {unreadCount > 9 ? "9+" : unreadCount}
          </motion.span>
        ) : null}
      </button>

      <AnimatePresence>
        {open ? (
          <>
            {/* Mobile backdrop — dims/blocks the chat behind the panel so a
                message's own hover-action menu or "asked" bubble (also
                z-50, but painted later in the DOM) can no longer visually
                poke through the notification list on phones. */}
            <div
              className="sm:hidden fixed inset-0 z-[55] bg-black/20"
              onClick={() => setOpen(false)}
              aria-hidden="true"
            />
            <motion.div
              initial={{ opacity: 0, y: 8, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.96 }}
              transition={{ duration: 0.15 }}
              // On phones this anchors to the viewport instead of the bell: a
              // fixed 320px popover hanging off `right-0` overflowed a 375px
              // screen and collided with the header. Opaque background too —
              // `glass-strong` let the page text show through the list.
              // z-[60], not z-50: several in-page elements (message hover
              // toolbars, sidebar drawers) also use z-50, and since they
              // mount later in the DOM they'd win equal-z-index paint order
              // and render on top of this panel — exactly the overlap bug
              // reported on mobile.
              className="fixed sm:absolute left-2 right-2 top-16 sm:left-auto sm:right-0 sm:top-auto sm:mt-2 sm:w-96 bg-card border border-border rounded-2xl shadow-2xl z-[60] overflow-hidden"
              role="dialog"
              aria-label="Notifications"
            >
            <div className="flex items-center justify-between p-3 border-b border-border">
              <h3 className="text-sm font-semibold">Notifications</h3>
              <div className="flex items-center gap-1">
                {unreadCount > 0 ? (
                  <button
                    type="button"
                    onClick={markAllRead}
                    className="text-xs text-primary hover:underline"
                  >
                    Mark all read
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="p-1 rounded hover:bg-accent/60"
                  aria-label="Close notifications"
                >
                  <X className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
              </div>
            </div>
            <div className="max-h-[60vh] sm:max-h-96 overflow-y-auto scrollbar-thin">
              {notifications.length === 0 ? (
                <div className="p-6 text-center text-sm text-muted-foreground">
                  <CheckCircle2 className="w-6 h-6 mx-auto mb-2 opacity-40" aria-hidden="true" />
                  You're all caught up!
                </div>
              ) : (
                <ul className="divide-y divide-border">
                  {notifications.map((n) => {
                    const Icon = TYPE_ICONS[n.type];
                    const color = TYPE_COLORS[n.type];
                    return (
                      <li
                        key={n.id}
                        className={`flex items-start gap-2 p-3 hover:bg-accent/30 ${!n.read ? "bg-primary/5" : ""}`}
                      >
                        <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${color}`} aria-hidden="true" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{n.title}</p>
                          <p className="text-xs text-muted-foreground line-clamp-2">{n.body}</p>
                          <p className="text-[10px] text-muted-foreground mt-0.5">
                            {new Date(n.timestamp).toLocaleString()}
                          </p>
                        </div>
                        {!n.read ? (
                          <span className="w-2 h-2 rounded-full bg-primary shrink-0 mt-1.5" aria-label="Unread" />
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
            </motion.div>
          </>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
