import { useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import { KeyRound, LogOut, CheckCircle2 } from "lucide-react";
import { useAuth } from "../../../lib/AuthContext";
import { resetPasswordForEmail } from "../../../lib/auth";
import { SettingsDetailShell, SettingsSection, SettingsRow, SettingsHint } from "./SettingsUI";

export function SecuritySettings() {
  const { currentUser, logout } = useAuth();
  const navigate = useNavigate();
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSendReset = useCallback(async () => {
    if (!currentUser?.email) return;
    setSending(true);
    setError(null);
    setMessage(null);
    try {
      await resetPasswordForEmail(currentUser.email);
      setMessage(`Reset link sent to ${currentUser.email}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send reset link.");
    } finally {
      setSending(false);
    }
  }, [currentUser?.email]);

  const handleLogout = useCallback(async () => {
    await logout();
    navigate("/login");
  }, [logout, navigate]);

  return (
    <SettingsDetailShell title="Security & login" subtitle="Manage sign-in for your account" icon={KeyRound}>
      <SettingsSection label="Account">
        <SettingsRow label="Email" value={currentUser?.email ?? "—"} chevron={false} />
      </SettingsSection>

      <div className="space-y-2">
        <SettingsSection>
          <SettingsRow
            icon={KeyRound}
            label="Reset password"
            description="Email yourself a secure link to set a new password"
            onClick={handleSendReset}
            chevron={false}
          />
        </SettingsSection>
        {sending ? <SettingsHint>Sending…</SettingsHint> : null}
        {message ? (
          <p className="text-[13px] text-primary flex items-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
            {message}
          </p>
        ) : null}
        {error ? <p className="text-[13px] text-destructive">{error}</p> : null}
      </div>

      <SettingsSection>
        <SettingsRow icon={LogOut} label="Sign out" onClick={handleLogout} chevron={false} danger />
      </SettingsSection>
    </SettingsDetailShell>
  );
}
