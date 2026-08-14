import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { UserRound, Mail, Calendar, MapPin, Save, CheckCircle2, Settings as SettingsIcon, ShieldCheck, Camera, AlertCircle } from "lucide-react";
import { supabase } from "../../lib/supabaseClient";
import { useAuth } from "../../lib/AuthContext";
import { formatRoleLabel } from "../../lib/auth";
import { BRAND } from "../../lib/brand";
import { Card } from "../common/AdminUI";
import { AppHeader } from "../common/AppHeader";
import { Button } from "../ui/button";
import { UserAvatar } from "../common/UserAvatar";

const AVATAR_BUCKET = "avatars";
const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

type ProfileRow = {
  full_name: string | null;
  role: string | null;
  region: string | null;
  created_at: string | null;
};

function formatMemberSince(iso: string | null) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "long" });
}

export function UserProfile() {
  const { currentUser, role, refresh: refreshAuth } = useAuth();
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [fullName, setFullName] = useState("");
  const [region, setRegion] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const avatarInputRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async () => {
    if (!supabase || !currentUser?.id) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const { data } = await supabase
        .from("profiles")
        .select("full_name, role, region, created_at")
        .eq("id", currentUser.id)
        .maybeSingle();
      const row = data as ProfileRow | null;
      setProfile(row);
      setFullName(row?.full_name ?? String(currentUser.user_metadata?.full_name ?? ""));
      setRegion(row?.region ?? "");
    } finally {
      setLoading(false);
    }
  }, [currentUser?.id, currentUser?.user_metadata?.full_name]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSave = async () => {
    if (!supabase || !currentUser?.id || saving) return;
    setSaving(true);
    setError(null);
    try {
      const { error: err } = await supabase
        .from("profiles")
        .update({ full_name: fullName.trim() || null, region: region.trim() || null })
        .eq("id", currentUser.id);
      if (err) throw err;
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save your profile.");
    } finally {
      setSaving(false);
    }
  };

  const handleAvatarPick = async (file: File | undefined) => {
    if (!file || !currentUser?.id) return;
    if (!file.type.startsWith("image/")) {
      setAvatarError("Please choose an image file.");
      return;
    }
    if (file.size > MAX_AVATAR_BYTES) {
      setAvatarError("Image must be under 5 MB.");
      return;
    }
    if (!supabase) {
      setAvatarError("Photo upload needs Supabase to be configured — you're in demo mode.");
      return;
    }
    setAvatarUploading(true);
    setAvatarError(null);
    try {
      const ext = file.name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
      const path = `${currentUser.id}/${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from(AVATAR_BUCKET)
        .upload(path, file, { contentType: file.type, upsert: true });
      if (upErr) {
        // Most common cause: the "avatars" bucket doesn't exist yet in this
        // Supabase project. Surface that plainly rather than a raw SDK error.
        if (/bucket/i.test(upErr.message) && /not found|does not exist/i.test(upErr.message)) {
          throw new Error(
            'Photo storage isn\'t set up yet. In Supabase → Storage, create a public bucket named "avatars", then try again.',
          );
        }
        throw upErr;
      }
      const { data: pub } = supabase.storage.from(AVATAR_BUCKET).getPublicUrl(path);
      const { error: metaErr } = await supabase.auth.updateUser({
        data: { avatar_url: pub.publicUrl },
      });
      if (metaErr) throw metaErr;
      await refreshAuth();
    } catch (e) {
      setAvatarError(e instanceof Error ? e.message : "Could not upload photo.");
    } finally {
      setAvatarUploading(false);
    }
  };

  const displayName = fullName || currentUser?.email?.split("@")[0] || "Dayjoy User";
  const initials = displayName
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  const memberSince = formatMemberSince(profile?.created_at ?? null);

  return (
    <div className="flex-1 flex flex-col min-w-0 min-h-0">
      <AppHeader title="Profile" subtitle={`Your ${BRAND.name} account details.`} icon={UserRound} showBackButton />
      <div className="flex-1 overflow-y-auto">
      <div className="p-4 sm:p-6 lg:p-8 max-w-3xl mx-auto w-full">
        {loading ? (
          <div className="text-sm text-muted-foreground py-8 text-center">Loading your profile…</div>
        ) : (
          <div className="space-y-4">
            <Card className="bg-gradient-to-br from-primary/8 to-transparent border-primary/15">
              <div className="flex items-center gap-4">
                <div className="relative shrink-0">
                  <input
                    ref={avatarInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      void handleAvatarPick(e.target.files?.[0]);
                      e.target.value = "";
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => avatarInputRef.current?.click()}
                    disabled={avatarUploading}
                    className="group relative block w-16 h-16 rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 disabled:cursor-wait"
                    aria-label="Change profile photo"
                    title="Change profile photo"
                  >
                    <UserAvatar user={currentUser} initials={initials} size={64} className="text-xl" />
                    <span className="absolute inset-0 rounded-full bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
                      <Camera className="w-5 h-5 text-white" aria-hidden="true" />
                    </span>
                    {avatarUploading ? (
                      <span className="absolute inset-0 rounded-full bg-black/40 flex items-center justify-center">
                        <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" aria-hidden="true" />
                      </span>
                    ) : null}
                  </button>
                </div>
                <div className="min-w-0 flex-1">
                  <h2 className="text-lg font-semibold truncate">{displayName}</h2>
                  <p className="text-sm text-muted-foreground truncate flex items-center gap-1.5 mt-0.5">
                    <Mail className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                    {currentUser?.email ?? "Demo session"}
                  </p>
                  <div className="flex items-center gap-3 mt-2 flex-wrap">
                    {role ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-primary/10 text-primary">
                        <ShieldCheck className="w-3 h-3" aria-hidden="true" /> {formatRoleLabel(role)}
                      </span>
                    ) : null}
                    {memberSince ? (
                      <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                        <Calendar className="w-3 h-3" aria-hidden="true" /> Member since {memberSince}
                      </span>
                    ) : null}
                  </div>
                </div>
              </div>
              {avatarError ? (
                <p role="alert" className="mt-3 text-xs text-destructive flex items-start gap-1.5">
                  <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />
                  {avatarError}
                </p>
              ) : null}
            </Card>

            {error ? (
              <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                {error}
              </div>
            ) : null}

            <Card>
              <h2 className="font-semibold mb-3">Account details</h2>
              <div className="space-y-3">
                <div>
                  <label htmlFor="dj-profile-name" className="block text-xs font-medium text-muted-foreground mb-1">
                    Full name
                  </label>
                  <input
                    id="dj-profile-name"
                    type="text"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Your name"
                    className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                  />
                </div>
                <div>
                  <label htmlFor="dj-profile-region" className="block text-xs font-medium text-muted-foreground mb-1">
                    Region
                  </label>
                  <div className="relative">
                    <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
                    <input
                      id="dj-profile-region"
                      type="text"
                      value={region}
                      onChange={(e) => setRegion(e.target.value)}
                      placeholder="e.g. Mumbai, India"
                      className="w-full pl-9 pr-3 py-2 rounded-lg border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">Email</label>
                  <p className="px-3 py-2 rounded-lg border border-border bg-accent/30 text-sm text-muted-foreground truncate">
                    {currentUser?.email ?? "—"}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3 mt-4">
                <Button type="button" onClick={handleSave} disabled={saving}>
                  <Save className="w-4 h-4" aria-hidden="true" />
                  {saving ? "Saving…" : "Save profile"}
                </Button>
                {saved ? (
                  <span className="inline-flex items-center gap-1 text-sm text-primary">
                    <CheckCircle2 className="w-4 h-4" aria-hidden="true" /> Saved
                  </span>
                ) : null}
              </div>
            </Card>

            <Card className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <p className="text-sm font-medium">Preferences, notifications & AI memory</p>
                <p className="text-xs text-muted-foreground mt-0.5">Manage language, push notifications, and what the AI remembers.</p>
              </div>
              <Link
                to="/settings"
                className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg border border-border bg-card hover:bg-accent/60 transition-colors shrink-0"
              >
                <SettingsIcon className="w-3.5 h-3.5" aria-hidden="true" /> Open Settings
              </Link>
            </Card>
          </div>
        )}
      </div>
      </div>
    </div>
  );
}
