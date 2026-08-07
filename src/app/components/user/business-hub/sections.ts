import type { LucideIcon } from "lucide-react";
import {
  LayoutDashboard, Users, Wallet, TrendingUp, ShoppingCart, UserCircle,
  Package, Target, Flag, BarChart3, Sparkles, Lightbulb, Bell, UserX,
  CalendarClock, ListChecks, FileText, Award, Percent, Settings as SettingsIcon,
  MessageSquareText, GraduationCap,
} from "lucide-react";

export type BusinessHubSection = {
  key: string;
  path: string;
  label: string;
  icon: LucideIcon;
};

/** Secondary-sidebar nav for the Business Hub workspace. Order = display order. */
export const BUSINESS_HUB_SECTIONS: BusinessHubSection[] = [
  { key: "overview", path: "overview", label: "Overview", icon: LayoutDashboard },
  { key: "ai-sales-coach", path: "ai-sales-coach", label: "AI Sales Coach", icon: MessageSquareText },
  { key: "team", path: "team", label: "Team", icon: Users },
  { key: "income", path: "income", label: "Income", icon: Wallet },
  { key: "sales", path: "sales", label: "Sales", icon: TrendingUp },
  { key: "orders", path: "orders", label: "Orders", icon: ShoppingCart },
  { key: "customers", path: "customers", label: "Customers", icon: UserCircle },
  { key: "content", path: "content", label: "Content Generator", icon: Sparkles },
  { key: "products", path: "products", label: "Products", icon: Package },
  { key: "goals", path: "goals", label: "Goals", icon: Target },
  { key: "targets", path: "targets", label: "Targets", icon: Flag },
  { key: "analytics", path: "analytics", label: "Analytics", icon: BarChart3 },
  { key: "ai-insights", path: "ai-insights", label: "AI Insights", icon: Sparkles },
  { key: "opportunities", path: "opportunities", label: "Opportunities", icon: Lightbulb },
  { key: "alerts", path: "alerts", label: "Alerts", icon: Bell },
  { key: "dead-members", path: "dead-members", label: "Dead Members", icon: UserX },
  { key: "follow-ups", path: "follow-ups", label: "Follow Ups", icon: CalendarClock },
  { key: "meetings", path: "meetings", label: "Meetings", icon: CalendarClock },
  { key: "tasks", path: "tasks", label: "Tasks", icon: ListChecks },
  { key: "reports", path: "reports", label: "Reports", icon: FileText },
  { key: "rank-progress", path: "rank-progress", label: "Rank Progress", icon: Award },
  { key: "commission", path: "commission", label: "Commission", icon: Percent },
  { key: "inventory", path: "inventory", label: "Inventory", icon: Package },
  { key: "training", path: "training", label: "Training", icon: GraduationCap },
  { key: "settings", path: "settings", label: "Settings", icon: SettingsIcon },
];

export const BUSINESS_HUB_LAST_SECTION_KEY = "dj-business-hub-last-section";
export const DEFAULT_SECTION = "overview";
