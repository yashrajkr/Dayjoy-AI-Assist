import { Settings as SettingsIcon, User, ArrowRight } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "../../../ui/button";
import { Section } from "../../BusinessIntelligence";

/** Points to the existing global Profile/Settings pages rather than duplicating them. */
export function SettingsPage() {
  const navigate = useNavigate();
  return (
    <div className="p-4 sm:p-6 max-w-2xl mx-auto space-y-4">
      <h1 className="text-xl font-semibold flex items-center gap-2"><SettingsIcon className="w-5 h-5 text-primary" /> Settings</h1>
      <Section title="Profile & Account" icon={<User className="w-4 h-4 text-primary" />}>
        <p className="text-sm text-muted-foreground mb-4">
          Update your distributor profile, sponsor details, and KYC status.
        </p>
        <Button onClick={() => navigate("/profile")}>
          Open Profile <ArrowRight className="w-4 h-4 ml-1.5" />
        </Button>
      </Section>
      <Section title="App Settings" icon={<SettingsIcon className="w-4 h-4 text-primary" />}>
        <p className="text-sm text-muted-foreground mb-4">
          Notifications, language, theme, and account preferences.
        </p>
        <Button variant="outline" onClick={() => navigate("/settings")}>
          Open Settings <ArrowRight className="w-4 h-4 ml-1.5" />
        </Button>
      </Section>
    </div>
  );
}
