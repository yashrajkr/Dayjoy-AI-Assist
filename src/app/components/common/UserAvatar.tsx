import type { User } from "@supabase/supabase-js";

/** Avatar is stored on Supabase Auth's own user_metadata (no `profiles`
 * column needed) — same pattern already used for full_name elsewhere. */
export function getAvatarUrl(user: User | null | undefined): string | null {
  const url = user?.user_metadata?.avatar_url;
  return typeof url === "string" && url ? url : null;
}

export function UserAvatar({
  user,
  initials,
  size = 36,
  className = "",
}: {
  user: User | null | undefined;
  initials: string;
  size?: number;
  className?: string;
}) {
  const url = getAvatarUrl(user);
  if (url) {
    return (
      <img
        src={url}
        alt=""
        className={`rounded-full object-cover shrink-0 ${className}`}
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <div
      className={`rounded-full bg-forest text-forest-foreground flex items-center justify-center font-medium shrink-0 ${className}`}
      style={{ width: size, height: size, fontSize: Math.max(10, size * 0.38) }}
      aria-hidden="true"
    >
      {initials}
    </div>
  );
}
