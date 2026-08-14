import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, Download } from "lucide-react";
import { useAuth } from "../../lib/AuthContext";
import { hasMultipleViews } from "../../lib/workspace";
import { useInstallPrompt, isStandalone } from "../../lib/useInstallPrompt";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";

/**
 * AccountMenu — the avatar button in the top bar.
 *
 * Previously each header rendered this as an `aria-hidden` <div>, so it was
 * invisible to assistive tech and tapping it did nothing at all. Shared here
 * so the header and the chat page cannot drift apart again.
 */
export function AccountMenu() {
  const { currentUser, role, logout } = useAuth();
  const navigate = useNavigate();
  const { installable, installed, promptInstall } = useInstallPrompt();

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
          className="w-8 h-8 rounded-full bg-forest text-forest-foreground flex items-center justify-center font-medium text-xs shrink-0 ml-1 transition-opacity hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
          aria-label="Account menu"
          title={currentUser?.email ?? "Account"}
        >
          {initials}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="truncate">
          {currentUser?.email ?? "Account"}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => navigate("/settings")}>Profile</DropdownMenuItem>
        <DropdownMenuItem onClick={() => navigate("/settings")}>
          <Bell className="w-3.5 h-3.5" aria-hidden="true" /> Notifications
        </DropdownMenuItem>
        {!isStandalone() && !installed ? (
          <DropdownMenuItem onClick={() => (installable ? promptInstall() : navigate("/settings"))}>
            <Download className="w-3.5 h-3.5" aria-hidden="true" /> Downloads / Install App
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem onClick={() => navigate("/settings")}>Settings</DropdownMenuItem>
        {hasMultipleViews(role) ? (
          <DropdownMenuItem onClick={() => navigate("/workspace", { state: { voluntary: true } })}>Switch View</DropdownMenuItem>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleLogout}>Sign out</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
