import { lazy, Suspense, useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from "react-router-dom";
import { MotionConfig } from "framer-motion";
import { AuthProvider } from "./lib/AuthContext";
import { ProtectedRoute } from "./lib/ProtectedRoute";
import { StepUpGate } from "./lib/StepUpGate";
import { AppShellFallback } from "./components/common/AppShellFallback";
import { InstallAppPrompt } from "./components/common/InstallAppPrompt";
import { ThemeProvider } from "./components/common/ThemeProvider";
import { I18nProvider } from "./lib/i18n/I18nContext";
import { subscribeToNotificationClicks } from "./lib/pushNotifications";

// Eager-loaded: critical-path UI (login + selector + layout shells)
import { AppSelector } from "./components/AppSelector";
import { LoginPage } from "./components/user/LoginPage";
import { AuthCallback } from "./components/user/AuthCallback";
import { WorkspaceSwitcher } from "./components/user/WorkspaceSwitcher";
import { NotFound } from "./components/common/NotFound";
import { UserLayout } from "./components/user/UserLayout";
import { AdminLayout } from "./components/admin/AdminLayout";

// Lazy-loaded: route components — code-split per route so a customer
// logging in to ask one question does not download the entire admin console.
// Each chunk is requested only when the user navigates to that route.
const UserChat = lazy(() =>
  import("./components/user/UserChat").then((m) => ({ default: m.UserChat })),
);
const ProductDiscovery = lazy(() =>
  import("./components/user/ProductDiscovery").then((m) => ({ default: m.ProductDiscovery })),
);
const VoiceAssistant = lazy(() =>
  import("./components/user/VoiceAssistant").then((m) => ({ default: m.VoiceAssistant })),
);
const DistributorAssistant = lazy(() =>
  import("./components/user/DistributorAssistant").then((m) => ({
    default: m.DistributorAssistant,
  })),
);
const DistributorTraining = lazy(() =>
  import("./components/user/DistributorTraining").then((m) => ({
    default: m.DistributorTraining,
  })),
);
const HumanSupport = lazy(() =>
  import("./components/user/HumanSupport").then((m) => ({ default: m.HumanSupport })),
);
const UserSettings = lazy(() =>
  import("./components/user/UserSettings").then((m) => ({ default: m.UserSettings })),
);
const UserProfile = lazy(() =>
  import("./components/user/UserProfile").then((m) => ({ default: m.UserProfile })),
);
const LeadCapturePage = lazy(() =>
  import("./components/user/LeadCapturePage").then((m) => ({ default: m.LeadCapturePage })),
);

const AdminDashboard = lazy(() =>
  import("./components/admin/AdminDashboard").then((m) => ({ default: m.AdminDashboard })),
);
const KnowledgeManager = lazy(() =>
  import("./components/admin/KnowledgeManager").then((m) => ({ default: m.KnowledgeManager })),
);
const ProductDatabase = lazy(() =>
  import("./components/admin/ProductDatabase").then((m) => ({ default: m.ProductDatabase })),
);
const FAQManager = lazy(() =>
  import("./components/admin/FAQManager").then((m) => ({ default: m.FAQManager })),
);
const ApprovalQueue = lazy(() =>
  import("./components/admin/ApprovalQueue").then((m) => ({ default: m.ApprovalQueue })),
);
const UserManagement = lazy(() =>
  import("./components/admin/UserManagement").then((m) => ({ default: m.UserManagement })),
);
const SupportTickets = lazy(() =>
  import("./components/admin/SupportTickets").then((m) => ({ default: m.SupportTickets })),
);
const AdminAnalytics = lazy(() =>
  import("./components/admin/AdminAnalytics").then((m) => ({ default: m.AdminAnalytics })),
);
const AISafetyRules = lazy(() =>
  import("./components/admin/AISafetyRules").then((m) => ({ default: m.AISafetyRules })),
);
const PolicyManager = lazy(() =>
  import("./components/admin/PolicyManager").then((m) => ({ default: m.PolicyManager })),
);
const TrainingManager = lazy(() =>
  import("./components/admin/TrainingManager").then((m) => ({ default: m.TrainingManager })),
);
const LeadsCRM = lazy(() =>
  import("./components/admin/LeadsCRM").then((m) => ({ default: m.LeadsCRM })),
);
const AuditLogs = lazy(() =>
  import("./components/admin/AuditLogs").then((m) => ({ default: m.AuditLogs })),
);
const Integrations = lazy(() =>
  import("./components/admin/Integrations").then((m) => ({ default: m.Integrations })),
);
const AdminSettings = lazy(() =>
  import("./components/admin/AdminSettings").then((m) => ({ default: m.AdminSettings })),
);
const ManagementDashboard = lazy(() =>
  import("./components/admin/ManagementDashboard").then((m) => ({
    default: m.ManagementDashboard,
  })),
);
const EmployeeDashboard = lazy(() =>
  import("./components/admin/EmployeeDashboard").then((m) => ({ default: m.EmployeeDashboard })),
);
const LeaderDashboard = lazy(() =>
  import("./components/admin/LeaderDashboard").then((m) => ({ default: m.LeaderDashboard })),
);
const TrainerDashboard = lazy(() =>
  import("./components/admin/TrainerDashboard").then((m) => ({ default: m.TrainerDashboard })),
);
const SupportDashboard = lazy(() =>
  import("./components/admin/SupportDashboard").then((m) => ({ default: m.SupportDashboard })),
);
const KnowledgeTimeline = lazy(() =>
  import("./components/admin/KnowledgeTimeline").then((m) => ({ default: m.KnowledgeTimeline })),
);
const AIConfiguration = lazy(() =>
  import("./components/admin/AIConfiguration").then((m) => ({ default: m.AIConfiguration })),
);
const RolePermissions = lazy(() =>
  import("./components/admin/RolePermissions").then((m) => ({ default: m.RolePermissions })),
);
const UniversalSearch = lazy(() =>
  import("./components/admin/UniversalSearch").then((m) => ({ default: m.UniversalSearch })),
);
const BusinessIntelligence = lazy(() =>
  import("./components/user/BusinessIntelligence").then((m) => ({ default: m.BusinessIntelligence })),
);

// Business Hub workspace — secondary-sidebar shell + section pages, each
// code-split individually so switching sections only downloads what's needed.
const BusinessHubShell = lazy(() =>
  import("./components/user/business-hub/BusinessHubShell").then((m) => ({ default: m.BusinessHubShell })),
);
const BusinessHubIndexRedirect = lazy(() =>
  import("./components/user/business-hub/BusinessHubShell").then((m) => ({ default: m.BusinessHubIndexRedirect })),
);
const IncomePage = lazy(() =>
  import("./components/user/business-hub/pages/IncomePage").then((m) => ({ default: m.IncomePage })),
);
const CommissionPage = lazy(() =>
  import("./components/user/business-hub/pages/CommissionPage").then((m) => ({ default: m.CommissionPage })),
);
const SalesPage = lazy(() =>
  import("./components/user/business-hub/pages/SalesPage").then((m) => ({ default: m.SalesPage })),
);
const OrdersPage = lazy(() =>
  import("./components/user/business-hub/pages/OrdersPage").then((m) => ({ default: m.OrdersPage })),
);
const GoalsPage = lazy(() =>
  import("./components/user/business-hub/pages/GoalsPage").then((m) => ({ default: m.GoalsPage })),
);
const TargetsPage = lazy(() =>
  import("./components/user/business-hub/pages/TargetsPage").then((m) => ({ default: m.TargetsPage })),
);
const RankProgressPage = lazy(() =>
  import("./components/user/business-hub/pages/RankProgressPage").then((m) => ({ default: m.RankProgressPage })),
);
const AIInsightsPage = lazy(() =>
  import("./components/user/business-hub/pages/AIInsightsPage").then((m) => ({ default: m.AIInsightsPage })),
);
const AlertsPage = lazy(() =>
  import("./components/user/business-hub/pages/AlertsPage").then((m) => ({ default: m.AlertsPage })),
);
const DeadMembersPage = lazy(() =>
  import("./components/user/business-hub/pages/DeadMembersPage").then((m) => ({ default: m.DeadMembersPage })),
);
const MeetingsPage = lazy(() =>
  import("./components/user/business-hub/pages/MeetingsPage").then((m) => ({ default: m.MeetingsPage })),
);
const TasksPage = lazy(() =>
  import("./components/user/business-hub/pages/TasksPage").then((m) => ({ default: m.TasksPage })),
);
const ReportsPage = lazy(() =>
  import("./components/user/business-hub/pages/ReportsPage").then((m) => ({ default: m.ReportsPage })),
);
const OpportunitiesPage = lazy(() =>
  import("./components/user/business-hub/pages/OpportunitiesPage").then((m) => ({ default: m.OpportunitiesPage })),
);
const ProductsInventoryPage = lazy(() =>
  import("./components/user/business-hub/pages/ProductsInventoryPage").then((m) => ({ default: m.ProductsInventoryPage })),
);
const BusinessHubSettingsPage = lazy(() =>
  import("./components/user/business-hub/pages/SettingsPage").then((m) => ({ default: m.SettingsPage })),
);
const CustomerProfiles = lazy(() =>
  import("./components/user/CustomerProfiles").then((m) => ({ default: m.CustomerProfiles })),
);
const FollowUpManager = lazy(() =>
  import("./components/user/FollowUpManager").then((m) => ({ default: m.FollowUpManager })),
);
const ContentGenerator = lazy(() =>
  import("./components/user/ContentGenerator").then((m) => ({ default: m.ContentGenerator })),
);
const TeamManagement = lazy(() =>
  import("./components/user/TeamManagement").then((m) => ({ default: m.TeamManagement })),
);
const BusinessAnalytics = lazy(() =>
  import("./components/user/BusinessAnalytics").then((m) => ({ default: m.BusinessAnalytics })),
);
const CustomerDashboard = lazy(() =>
  import("./components/user/CustomerDashboard").then((m) => ({ default: m.CustomerDashboard })),
);
const Favorites = lazy(() =>
  import("./components/user/Favorites").then((m) => ({ default: m.Favorites })),
);
const WellnessJourney = lazy(() =>
  import("./components/user/WellnessJourney").then((m) => ({ default: m.WellnessJourney })),
);
const KnowledgeCenter = lazy(() =>
  import("./components/user/KnowledgeCenter").then((m) => ({ default: m.KnowledgeCenter })),
);
const ExecutiveDashboard = lazy(() =>
  import("./components/admin/ExecutiveDashboard").then((m) => ({ default: m.ExecutiveDashboard })),
);
const AnalyticsHub = lazy(() =>
  import("./components/admin/AnalyticsHub").then((m) => ({ default: m.AnalyticsHub })),
);
const CommunicationHub = lazy(() =>
  import("./components/admin/CommunicationHub").then((m) => ({ default: m.CommunicationHub })),
);
const AgentCenter = lazy(() =>
  import("./components/admin/AgentCenter").then((m) => ({ default: m.AgentCenter })),
);
const WorkflowAutomation = lazy(() =>
  import("./components/admin/WorkflowAutomation").then((m) => ({ default: m.WorkflowAutomation })),
);
const SecurityCenter = lazy(() =>
  import("./components/admin/SecurityCenter").then((m) => ({ default: m.SecurityCenter })),
);

// Route roles — kept here so the policy is visible in one place.
// NOTE: admin/management are excluded from public self-signup (see LoginPage).
const ANY_LOGGED_IN = ["customer", "distributor", "leader", "trainer", "employee", "support", "management", "admin", "super_admin"] as const;
const ADMIN_OR_MGMT = ["admin", "management", "super_admin"] as const;
const STAFF_ONLY = ["employee", "support", "trainer", "leader", "admin", "management", "super_admin"] as const;

export default function App() {
  return (
    <MotionConfig reducedMotion="user">
    <ThemeProvider>
      <I18nProvider>
        <BrowserRouter>
          <AuthProvider>
        <NotificationClickBridge />
        <InstallAppPrompt />
        <Routes>
          {/* Public */}
          <Route path="/select" element={<AppSelector />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/auth/callback" element={<AuthCallback />} />
          <Route path="/lead-capture" element={<LeadCapturePage />} />
          <Route
            path="/workspace"
            element={
              <ProtectedRoute allowedRoles={[...ANY_LOGGED_IN]}>
                <WorkspaceSwitcher />
              </ProtectedRoute>
            }
          />

          {/* User app */}
          <Route
            path="/"
            element={
              <ProtectedRoute allowedRoles={[...ANY_LOGGED_IN]}>
                <UserLayout />
              </ProtectedRoute>
            }
          >
            <Route
              index
              element={
                <ProtectedRoute allowedRoles={[...ANY_LOGGED_IN]}>
                  <Suspense fallback={<AppShellFallback />}>
                    <UserChat />
                  </Suspense>
                </ProtectedRoute>
              }
            />
            <Route
              path="chat/:chatId?"
              element={
                <ProtectedRoute allowedRoles={[...ANY_LOGGED_IN]}>
                  <Suspense fallback={<AppShellFallback />}>
                    <UserChat />
                  </Suspense>
                </ProtectedRoute>
              }
            />
            <Route
              path="products"
              element={
                <ProtectedRoute allowedRoles={[...ANY_LOGGED_IN]}>
                  <Suspense fallback={<AppShellFallback />}>
                    <ProductDiscovery />
                  </Suspense>
                </ProtectedRoute>
              }
            />
            <Route
              path="voice"
              element={
                <ProtectedRoute allowedRoles={[...ANY_LOGGED_IN]}>
                  <Suspense fallback={<AppShellFallback />}>
                    <VoiceAssistant />
                  </Suspense>
                </ProtectedRoute>
              }
            />
            <Route
              path="distributor"
              element={
                <ProtectedRoute allowedRoles={["distributor", ...STAFF_ONLY]}>
                  <Suspense fallback={<AppShellFallback />}>
                    {/* Standalone route (outside BusinessHubShell, which
                        provides its own scroll container) — this page needs
                        its own here since the parent <main> is overflow-hidden. */}
                    <div className="h-full overflow-y-auto">
                      <DistributorAssistant />
                    </div>
                  </Suspense>
                </ProtectedRoute>
              }
            />
            <Route
              path="distributor/dashboard"
              element={
                <ProtectedRoute allowedRoles={["distributor", "leader", ...STAFF_ONLY]}>
                  <StepUpGate view="distributor">
                    <Suspense fallback={<AppShellFallback />}>
                      <BusinessHubShell />
                    </Suspense>
                  </StepUpGate>
                </ProtectedRoute>
              }
            >
              <Route index element={<Suspense fallback={<AppShellFallback />}><BusinessHubIndexRedirect /></Suspense>} />
              <Route path="overview" element={<Suspense fallback={<AppShellFallback />}><BusinessIntelligence /></Suspense>} />
              <Route path="ai-sales-coach" element={<Suspense fallback={<AppShellFallback />}><DistributorAssistant /></Suspense>} />
              <Route path="team" element={<Suspense fallback={<AppShellFallback />}><TeamManagement /></Suspense>} />
              <Route path="customers" element={<Suspense fallback={<AppShellFallback />}><CustomerProfiles /></Suspense>} />
              <Route path="content" element={<Suspense fallback={<AppShellFallback />}><ContentGenerator /></Suspense>} />
              <Route path="follow-ups" element={<Suspense fallback={<AppShellFallback />}><FollowUpManager /></Suspense>} />
              <Route path="analytics" element={<Suspense fallback={<AppShellFallback />}><BusinessAnalytics /></Suspense>} />
              <Route path="income" element={<Suspense fallback={<AppShellFallback />}><IncomePage /></Suspense>} />
              <Route path="commission" element={<Suspense fallback={<AppShellFallback />}><CommissionPage /></Suspense>} />
              <Route path="sales" element={<Suspense fallback={<AppShellFallback />}><SalesPage /></Suspense>} />
              <Route path="orders" element={<Suspense fallback={<AppShellFallback />}><OrdersPage /></Suspense>} />
              <Route path="products" element={<Suspense fallback={<AppShellFallback />}><ProductsInventoryPage /></Suspense>} />
              <Route path="inventory" element={<Suspense fallback={<AppShellFallback />}><ProductsInventoryPage /></Suspense>} />
              <Route path="goals" element={<Suspense fallback={<AppShellFallback />}><GoalsPage /></Suspense>} />
              <Route path="targets" element={<Suspense fallback={<AppShellFallback />}><TargetsPage /></Suspense>} />
              <Route path="ai-insights" element={<Suspense fallback={<AppShellFallback />}><AIInsightsPage /></Suspense>} />
              <Route path="opportunities" element={<Suspense fallback={<AppShellFallback />}><OpportunitiesPage /></Suspense>} />
              <Route path="alerts" element={<Suspense fallback={<AppShellFallback />}><AlertsPage /></Suspense>} />
              <Route path="dead-members" element={<Suspense fallback={<AppShellFallback />}><DeadMembersPage /></Suspense>} />
              <Route path="meetings" element={<Suspense fallback={<AppShellFallback />}><MeetingsPage /></Suspense>} />
              <Route path="tasks" element={<Suspense fallback={<AppShellFallback />}><TasksPage /></Suspense>} />
              <Route path="reports" element={<Suspense fallback={<AppShellFallback />}><ReportsPage /></Suspense>} />
              <Route path="rank-progress" element={<Suspense fallback={<AppShellFallback />}><RankProgressPage /></Suspense>} />
              <Route path="training" element={<Suspense fallback={<AppShellFallback />}><DistributorTraining /></Suspense>} />
              <Route path="settings" element={<Suspense fallback={<AppShellFallback />}><BusinessHubSettingsPage /></Suspense>} />
            </Route>
            <Route
              path="distributor/customers"
              element={
                <ProtectedRoute allowedRoles={["distributor", "leader", ...STAFF_ONLY]}>
                  <Suspense fallback={<AppShellFallback />}>
                    <CustomerProfiles />
                  </Suspense>
                </ProtectedRoute>
              }
            />
            <Route
              path="distributor/follow-ups"
              element={
                <ProtectedRoute allowedRoles={["distributor", "leader", ...STAFF_ONLY]}>
                  <Suspense fallback={<AppShellFallback />}>
                    <FollowUpManager />
                  </Suspense>
                </ProtectedRoute>
              }
            />
            <Route
              path="distributor/content"
              element={
                <ProtectedRoute allowedRoles={["distributor", "leader", ...STAFF_ONLY]}>
                  <Suspense fallback={<AppShellFallback />}>
                    <ContentGenerator />
                  </Suspense>
                </ProtectedRoute>
              }
            />
            <Route
              path="distributor/team"
              element={
                <ProtectedRoute allowedRoles={["distributor", "leader", ...STAFF_ONLY]}>
                  <Suspense fallback={<AppShellFallback />}>
                    <TeamManagement />
                  </Suspense>
                </ProtectedRoute>
              }
            />
            <Route
              path="distributor/analytics"
              element={
                <ProtectedRoute allowedRoles={["distributor", "leader", ...STAFF_ONLY]}>
                  <Suspense fallback={<AppShellFallback />}>
                    <BusinessAnalytics />
                  </Suspense>
                </ProtectedRoute>
              }
            />
            <Route
              path="training"
              element={
                <ProtectedRoute allowedRoles={["distributor", "leader", "trainer", ...STAFF_ONLY]}>
                  <Suspense fallback={<AppShellFallback />}>
                    <DistributorTraining />
                  </Suspense>
                </ProtectedRoute>
              }
            />
            <Route
              path="support"
              element={
                <ProtectedRoute allowedRoles={[...ANY_LOGGED_IN]}>
                  <Suspense fallback={<AppShellFallback />}>
                    <HumanSupport />
                  </Suspense>
                </ProtectedRoute>
              }
            />
            <Route
              path="dashboard"
              element={
                <ProtectedRoute allowedRoles={[...ANY_LOGGED_IN]}>
                  <Suspense fallback={<AppShellFallback />}>
                    <CustomerDashboard />
                  </Suspense>
                </ProtectedRoute>
              }
            />
            <Route
              path="favorites"
              element={
                <ProtectedRoute allowedRoles={[...ANY_LOGGED_IN]}>
                  <Suspense fallback={<AppShellFallback />}>
                    <Favorites />
                  </Suspense>
                </ProtectedRoute>
              }
            />
            <Route
              path="wellness"
              element={
                <ProtectedRoute allowedRoles={[...ANY_LOGGED_IN]}>
                  <Suspense fallback={<AppShellFallback />}>
                    <WellnessJourney />
                  </Suspense>
                </ProtectedRoute>
              }
            />
            <Route
              path="knowledge"
              element={
                <ProtectedRoute allowedRoles={[...ANY_LOGGED_IN]}>
                  <Suspense fallback={<AppShellFallback />}>
                    <KnowledgeCenter />
                  </Suspense>
                </ProtectedRoute>
              }
            />
            <Route
              path="settings"
              element={
                <ProtectedRoute allowedRoles={[...ANY_LOGGED_IN]}>
                  <Suspense fallback={<AppShellFallback />}>
                    <UserSettings />
                  </Suspense>
                </ProtectedRoute>
              }
            />
            <Route
              path="profile"
              element={
                <ProtectedRoute allowedRoles={[...ANY_LOGGED_IN]}>
                  <Suspense fallback={<AppShellFallback />}>
                    <UserProfile />
                  </Suspense>
                </ProtectedRoute>
              }
            />
          </Route>

          {/* Admin console — ADMIN_OR_MGMT only at the layout level. */}
          <Route
            path="/admin"
            element={
              <ProtectedRoute allowedRoles={[...ADMIN_OR_MGMT]}>
                <AdminLayout />
              </ProtectedRoute>
            }
          >
            <Route index element={<Navigate to="/admin/dashboard" replace />} />

            {/* Admin + Management */}
            <Route
              path="dashboard"
              element={
                <ProtectedRoute allowedRoles={[...ADMIN_OR_MGMT]}>
                  <Suspense fallback={<AppShellFallback />}>
                    <AdminDashboard />
                  </Suspense>
                </ProtectedRoute>
              }
            />
            <Route
              path="executive"
              element={
                <ProtectedRoute allowedRoles={[...ADMIN_OR_MGMT]}>
                  <Suspense fallback={<AppShellFallback />}>
                    <ExecutiveDashboard />
                  </Suspense>
                </ProtectedRoute>
              }
            />
            <Route
              path="analytics-hub"
              element={
                <ProtectedRoute allowedRoles={[...ADMIN_OR_MGMT]}>
                  <Suspense fallback={<AppShellFallback />}>
                    <AnalyticsHub />
                  </Suspense>
                </ProtectedRoute>
              }
            />
            {/* CommunicationCenter was superseded by CommunicationHub (superset:
                channels+templates+campaigns+webhooks+automations). Redirect
                the old route so no bookmarked/linked URL 404s. */}
            <Route path="communication" element={<Navigate to="/admin/comm-hub" replace />} />
            <Route
              path="comm-hub"
              element={
                <ProtectedRoute allowedRoles={[...ADMIN_OR_MGMT]}>
                  <Suspense fallback={<AppShellFallback />}>
                    <CommunicationHub />
                  </Suspense>
                </ProtectedRoute>
              }
            />
            <Route
              path="agents"
              element={
                <ProtectedRoute allowedRoles={[...ADMIN_OR_MGMT]}>
                  <Suspense fallback={<AppShellFallback />}>
                    <AgentCenter />
                  </Suspense>
                </ProtectedRoute>
              }
            />
            <Route
              path="workflows"
              element={
                <ProtectedRoute allowedRoles={[...ADMIN_OR_MGMT]}>
                  <Suspense fallback={<AppShellFallback />}>
                    <WorkflowAutomation />
                  </Suspense>
                </ProtectedRoute>
              }
            />
            <Route
              path="security"
              element={
                <ProtectedRoute allowedRoles={[...ADMIN_OR_MGMT]}>
                  <Suspense fallback={<AppShellFallback />}>
                    <SecurityCenter />
                  </Suspense>
                </ProtectedRoute>
              }
            />
            <Route
              path="knowledge"
              element={
                <ProtectedRoute allowedRoles={[...ADMIN_OR_MGMT]}>
                  <Suspense fallback={<AppShellFallback />}>
                    <KnowledgeManager />
                  </Suspense>
                </ProtectedRoute>
              }
            />
            <Route
              path="products"
              element={
                <ProtectedRoute allowedRoles={[...ADMIN_OR_MGMT]}>
                  <Suspense fallback={<AppShellFallback />}>
                    <ProductDatabase />
                  </Suspense>
                </ProtectedRoute>
              }
            />
            <Route
              path="faqs"
              element={
                <ProtectedRoute allowedRoles={[...ADMIN_OR_MGMT]}>
                  <Suspense fallback={<AppShellFallback />}>
                    <FAQManager />
                  </Suspense>
                </ProtectedRoute>
              }
            />
            <Route
              path="policies"
              element={
                <ProtectedRoute allowedRoles={[...ADMIN_OR_MGMT]}>
                  <Suspense fallback={<AppShellFallback />}>
                    <PolicyManager />
                  </Suspense>
                </ProtectedRoute>
              }
            />
            <Route
              path="training"
              element={
                <ProtectedRoute allowedRoles={[...ADMIN_OR_MGMT]}>
                  <Suspense fallback={<AppShellFallback />}>
                    <TrainingManager />
                  </Suspense>
                </ProtectedRoute>
              }
            />
            <Route
              path="approvals"
              element={
                <ProtectedRoute allowedRoles={[...ADMIN_OR_MGMT]}>
                  <Suspense fallback={<AppShellFallback />}>
                    <ApprovalQueue />
                  </Suspense>
                </ProtectedRoute>
              }
            />
            <Route
              path="safety"
              element={
                <ProtectedRoute allowedRoles={[...ADMIN_OR_MGMT]}>
                  <Suspense fallback={<AppShellFallback />}>
                    <AISafetyRules />
                  </Suspense>
                </ProtectedRoute>
              }
            />
            <Route
              path="users"
              element={
                <ProtectedRoute allowedRoles={["admin", "super_admin"]}>
                  <Suspense fallback={<AppShellFallback />}>
                    <UserManagement />
                  </Suspense>
                </ProtectedRoute>
              }
            />
            <Route
              path="leads"
              element={
                <ProtectedRoute allowedRoles={[...ADMIN_OR_MGMT]}>
                  <Suspense fallback={<AppShellFallback />}>
                    <LeadsCRM />
                  </Suspense>
                </ProtectedRoute>
              }
            />
            <Route
              path="support"
              element={
                <ProtectedRoute allowedRoles={[...ADMIN_OR_MGMT]}>
                  <Suspense fallback={<AppShellFallback />}>
                    <SupportTickets />
                  </Suspense>
                </ProtectedRoute>
              }
            />
            <Route
              path="analytics"
              element={
                <ProtectedRoute allowedRoles={[...ADMIN_OR_MGMT]}>
                  <Suspense fallback={<AppShellFallback />}>
                    <AdminAnalytics />
                  </Suspense>
                </ProtectedRoute>
              }
            />
            <Route
              path="audit"
              element={
                <ProtectedRoute allowedRoles={["admin", "super_admin"]}>
                  <Suspense fallback={<AppShellFallback />}>
                    <AuditLogs />
                  </Suspense>
                </ProtectedRoute>
              }
            />
            <Route
              path="timeline"
              element={
                <ProtectedRoute allowedRoles={[...ADMIN_OR_MGMT]}>
                  <Suspense fallback={<AppShellFallback />}>
                    <KnowledgeTimeline />
                  </Suspense>
                </ProtectedRoute>
              }
            />
            <Route
              path="ai-config"
              element={
                <ProtectedRoute allowedRoles={["admin", "super_admin", ...ADMIN_OR_MGMT]}>
                  <Suspense fallback={<AppShellFallback />}>
                    <AIConfiguration />
                  </Suspense>
                </ProtectedRoute>
              }
            />
            <Route
              path="roles"
              element={
                <ProtectedRoute allowedRoles={["admin", "super_admin"]}>
                  <Suspense fallback={<AppShellFallback />}>
                    <RolePermissions />
                  </Suspense>
                </ProtectedRoute>
              }
            />
            <Route
              path="search"
              element={
                <ProtectedRoute allowedRoles={[...STAFF_ONLY, ...ADMIN_OR_MGMT]}>
                  <Suspense fallback={<AppShellFallback />}>
                    <UniversalSearch />
                  </Suspense>
                </ProtectedRoute>
              }
            />
            <Route
              path="integrations"
              element={
                <ProtectedRoute allowedRoles={[...ADMIN_OR_MGMT]}>
                  <Suspense fallback={<AppShellFallback />}>
                    <Integrations />
                  </Suspense>
                </ProtectedRoute>
              }
            />
            <Route
              path="settings"
              element={
                <ProtectedRoute allowedRoles={["admin", "super_admin"]}>
                  <Suspense fallback={<AppShellFallback />}>
                    <AdminSettings />
                  </Suspense>
                </ProtectedRoute>
              }
            />

            {/* Role-specific dashboards */}
            <Route
              path="employee"
              element={
                <ProtectedRoute allowedRoles={[...STAFF_ONLY]}>
                  <Suspense fallback={<AppShellFallback />}>
                    <EmployeeDashboard />
                  </Suspense>
                </ProtectedRoute>
              }
            />
            <Route
              path="leader"
              element={
                <ProtectedRoute allowedRoles={["leader", ...ADMIN_OR_MGMT]}>
                  <StepUpGate view="leader">
                    <Suspense fallback={<AppShellFallback />}>
                      <LeaderDashboard />
                    </Suspense>
                  </StepUpGate>
                </ProtectedRoute>
              }
            />
            <Route
              path="trainer"
              element={
                <ProtectedRoute allowedRoles={["trainer", ...ADMIN_OR_MGMT]}>
                  <Suspense fallback={<AppShellFallback />}>
                    <TrainerDashboard />
                  </Suspense>
                </ProtectedRoute>
              }
            />
            <Route
              path="support-team"
              element={
                <ProtectedRoute allowedRoles={["support", ...STAFF_ONLY]}>
                  <Suspense fallback={<AppShellFallback />}>
                    <SupportDashboard />
                  </Suspense>
                </ProtectedRoute>
              }
            />
            <Route
              path="management"
              element={
                <ProtectedRoute allowedRoles={[...ADMIN_OR_MGMT]}>
                  <Suspense fallback={<AppShellFallback />}>
                    <ManagementDashboard />
                  </Suspense>
                </ProtectedRoute>
              }
            />
          </Route>

          {/* Fallback — a distinct 404, not a silent redirect to Home, so a
              dead/mistyped/renamed link doesn't masquerade as a working page. */}
          <Route path="*" element={<NotFound />} />
        </Routes>
          </AuthProvider>
        </BrowserRouter>
      </I18nProvider>
    </ThemeProvider>
    </MotionConfig>
  );
}

/**
 * NotificationClickBridge — listens for "notification clicked" messages
 * posted by the Service Worker and routes the user to the target URL.
 *
 * When the user clicks a system notification (e.g. "Ticket updated"),
 * the SW posts `{ type: "NOTIFICATION_CLICK", route: "/support" }` to
 * the active client. This bridge converts that into a router navigation.
 *
 * Renders nothing — it's a side-effect only component.
 */
function NotificationClickBridge() {
  const navigate = useNavigate();
  useEffect(() => {
    const unsub = subscribeToNotificationClicks((route) => {
      navigate(route);
    });
    return unsub;
  }, [navigate]);
  return null;
}
