import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Download } from "lucide-react";
import { useAuth } from "../../lib/AuthContext";
import { hasMultipleViews } from "../../lib/workspace";
import { useInstallPrompt } from "../../lib/useInstallPrompt";
import { UserAvatar } from "./UserAvatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";

/**
 * AccountMenu — the avatar button in the top bar (desktop, and mobile
 * Explorer mode). There is no "Upgrade" entry — Dayjoy AI Assist has no
 * subscription tier to promote.
 */
export function AccountMenu() {
  const { currentUser, role, logout } = useAuth();
  const navigate = useNavigate();
  const { canInstall, promptInstall } = useInstallPrompt();

  const initials =
    currentUser?.email?.slice(0, 2).toUpperCase() ??
    currentUser?.user_metadata?.full_name?.slice(0, 2)?.toUpperCase() ??
    "DU";

  const handleLogout = useCallback(async () => {
    await logout();
    navigate("/login");
  }, [logout, navigate]);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="ml-1 rounded-full transition-opacity hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
          aria-label="Account menu"
          title={currentUser?.email ?? "Account"}
        >
          <UserAvatar user={currentUser} initials={initials} size={32} className="text-xs" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="truncate">
          {currentUser?.email ?? "Account"}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => navigate("/profile")}>Profile</DropdownMenuItem>
        <DropdownMenuItem onClick={() => navigate("/settings")}>Notifications</DropdownMenuItem>
        {canInstall ? (
          <DropdownMenuItem onClick={() => void promptInstall()}>
            <Download className="w-3.5 h-3.5 mr-2" aria-hidden="true" />
            Install Dayjoy AI
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem onClick={() => navigate("/settings")}>Settings</DropdownMenuItem>
        {hasMultipleViews(role) ? (
          <DropdownMenuItem onClick={() => navigate("/workspace", { state: { voluntary: true } })}>Switch View</DropdownMenuItem>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => navigate("/support")}>Help & Support</DropdownMenuItem>
        <DropdownMenuItem onClick={handleLogout}>Sign out</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
