import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Heart, Clock, Target, Headphones, Bell, Sparkles,
  Package, MessageSquare, ArrowRight, Megaphone,
} from "lucide-react";
import { customerDashboard, type CustomerDashboard as DashboardData } from "../../../lib/api";
import { LoadingState, ErrorState } from "../common/AdminUI";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { useAuth } from "../../lib/AuthContext";

export function CustomerDashboard() {
  const { currentUser } = useAuth();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const d = await customerDashboard();
      setData(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load dashboard");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="p-4 sm:p-6 max-w-5xl mx-auto"><LoadingState label="Loading your dashboard…" /></div>;
  if (error) return <div className="p-4 sm:p-6 max-w-5xl mx-auto"><ErrorState message={error} /></div>;
  if (!data) return null;

  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 12) return "Good morning";
    if (h < 17) return "Good afternoon";
    return "Good evening";
  })();

  const userName = (currentUser?.user_metadata?.full_name as string) || currentUser?.email?.split("@")[0] || "there";

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-4">
      {/* Welcome header */}
      <div className="rounded-2xl surface-gradient border border-border/60 p-4 sm:p-6">
        <h1 className="text-xl sm:text-2xl font-semibold">{greeting}, {userName}! 👋</h1>
        <p className="text-sm text-muted-foreground mt-1">Here's what's happening with your Dayjourney today.</p>
        <div className="flex flex-wrap gap-2 mt-3">
          <Button asChild size="sm">
            <Link to="/"><Sparkles className="w-3.5 h-3.5" /> Ask AI Assistant</Link>
          </Button>
          <Button asChild variant="secondary" size="sm">
            <Link to="/products"><Package className="w-3.5 h-3.5" /> Browse Products</Link>
          </Button>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiCard label="Favorites" value={data.kpis.favorite_products} icon={<Heart className="w-4 h-4" />} link="/favorites" />
        <KpiCard label="Recently Viewed" value={data.kpis.recently_viewed_count} icon={<Clock className="w-4 h-4" />} link="/products" />
        <KpiCard label="Wellness Goals" value={data.kpis.active_wellness_goals} icon={<Target className="w-4 h-4" />} link="/wellness" />
        <KpiCard label="Open Tickets" value={data.kpis.open_tickets} icon={<Headphones className="w-4 h-4" />} link="/support" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Recommended products */}
        <Section title="Recommended for You" icon={<Sparkles className="w-4 h-4 text-primary" />} link="/products">
          {data.recommended_products.length === 0 ? <Empty text="No recommendations yet." /> : (
            <ul className="space-y-1.5">
              {data.recommended_products.slice(0, 4).map((p) => (
                <li key={String(p.id)} className="flex items-center gap-2 text-xs p-2 rounded-lg hover:bg-accent/30">
                  <Package className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  <span className="flex-1 truncate font-medium">{String(p.product_name || "")}</span>
                  <span className="text-[10px] text-muted-foreground">{String(p.category || "")}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        {/* Favorite products */}
        <Section title="Your Favorites" icon={<Heart className="w-4 h-4 text-primary" />} link="/favorites">
          {data.favorites.length === 0 ? <Empty text="No favorites yet. Tap the heart on any product!" /> : (
            <ul className="space-y-1.5">
              {data.favorites.slice(0, 4).map((f) => (
                <li key={String(f.id)} className="flex items-center gap-2 text-xs p-2 rounded-lg hover:bg-accent/30">
                  <Heart className="w-3.5 h-3.5 text-rose-500 fill-rose-500 shrink-0" />
                  <span className="flex-1 truncate">{String(f.entity_name || "Untitled")}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        {/* Announcements */}
        <Section title="Announcements" icon={<Megaphone className="w-4 h-4 text-primary" />}>
          {data.announcements.length === 0 ? <Empty text="No announcements right now." /> : (
            <ul className="space-y-2">
              {data.announcements.slice(0, 3).map((a) => (
                <li key={String(a.id)} className="rounded-lg border border-border p-2">
                  <p className="text-xs font-medium">{String(a.title || "")}</p>
                  <p className="text-[10px] text-muted-foreground line-clamp-2 mt-0.5">{String(a.body || "").slice(0, 120)}</p>
                </li>
              ))}
            </ul>
          )}
        </Section>

        {/* Support tickets */}
        <Section title="Support Tickets" icon={<Headphones className="w-4 h-4 text-primary" />} link="/support">
          {data.tickets.length === 0 ? <Empty text="No open tickets." /> : (
            <ul className="space-y-1.5">
              {data.tickets.slice(0, 3).map((t) => (
                <li key={String(t.id)} className="flex items-center gap-2 text-xs p-2 rounded-lg hover:bg-accent/30">
                  <span className={`w-1.5 h-1.5 rounded-full ${t.status === "resolved" ? "bg-primary" : "bg-warning"}`} />
                  <span className="flex-1 truncate">{String(t.query || t.issue_category || "Ticket").slice(0, 50)}</span>
                  <span className="text-[10px] text-muted-foreground capitalize">{String(t.status || "")}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        {/* Wellness goals */}
        <Section title="Wellness Goals" icon={<Target className="w-4 h-4 text-primary" />} link="/wellness">
          {data.wellness_goals.length === 0 ? <Empty text="Set your first wellness goal!" /> : (
            <ul className="space-y-2">
              {data.wellness_goals.slice(0, 3).map((g) => {
                const target = Number(g.target_value || 0);
                const current = Number(g.current_value || 0);
                const pct = target > 0 ? Math.min(100, (current / target) * 100) : 0;
                return (
                  <li key={String(g.id)} className="text-xs">
                    <div className="flex justify-between mb-0.5">
                      <span className="font-medium">{String(g.title || "Goal")}</span>
                      <span className="text-muted-foreground">{current}/{target} {String(g.unit || "")}</span>
                    </div>
                    <div className="h-1.5 bg-accent rounded-full overflow-hidden">
                      <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Section>

        {/* Reminders */}
        <Section title="Active Reminders" icon={<Bell className="w-4 h-4 text-primary" />} link="/wellness">
          {data.reminders.length === 0 ? <Empty text="No active reminders." /> : (
            <ul className="space-y-1.5">
              {data.reminders.slice(0, 3).map((r) => (
                <li key={String(r.id)} className="flex items-center gap-2 text-xs p-2 rounded-lg hover:bg-accent/30">
                  <Bell className="w-3.5 h-3.5 text-primary shrink-0" />
                  <span className="flex-1 truncate">{String(r.title || "Reminder")}</span>
                  <span className="text-[10px] text-muted-foreground capitalize">{String(r.frequency || "")}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      {/* Quick actions */}
      <Card className="p-4 shadow-none">
        <h2 className="text-sm font-semibold mb-2">Quick Actions</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Button asChild variant="outline" className="h-auto flex-col gap-1 py-2 text-xs font-normal">
            <Link to="/"><MessageSquare className="w-4 h-4" /> Ask AI</Link>
          </Button>
          <Button asChild variant="outline" className="h-auto flex-col gap-1 py-2 text-xs font-normal">
            <Link to="/products"><Package className="w-4 h-4" /> Products</Link>
          </Button>
          <Button asChild variant="outline" className="h-auto flex-col gap-1 py-2 text-xs font-normal">
            <Link to="/favorites"><Heart className="w-4 h-4" /> Favorites</Link>
          </Button>
          <Button asChild variant="outline" className="h-auto flex-col gap-1 py-2 text-xs font-normal">
            <Link to="/knowledge"><Sparkles className="w-4 h-4" /> Knowledge</Link>
          </Button>
        </div>
      </Card>
    </div>
  );
}

function KpiCard({ label, value, icon, link }: { label: string; value: number; icon: React.ReactNode; link?: string }) {
  const content = (
    <Card className="hover-raise p-3.5 shadow-flat">
      <div className="flex items-start justify-between gap-2 mb-2">
        <span className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</span>
        <span className="w-7 h-7 rounded-lg bg-accent text-primary flex items-center justify-center shrink-0">{icon}</span>
      </div>
      <p className="text-2xl font-semibold tabular tracking-tight">{value}</p>
    </Card>
  );
  return link ? <Link to={link}>{content}</Link> : content;
}

function Section({ title, icon, link, children }: { title: string; icon: React.ReactNode; link?: string; children: React.ReactNode }) {
  return (
    <Card className="p-4 shadow-flat">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold flex items-center gap-1.5">{icon} {title}</h2>
        {link ? <Link to={link} className="text-xs text-primary hover:underline flex items-center gap-0.5">View all <ArrowRight className="w-3 h-3" /></Link> : null}
      </div>
      {children}
    </Card>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="text-xs text-muted-foreground py-3 text-center">{text}</p>;
}
