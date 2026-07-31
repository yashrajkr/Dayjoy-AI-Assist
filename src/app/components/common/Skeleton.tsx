import { clsx } from "clsx";

/**
 * Skeleton — premium shimmer placeholder.
 *
 * Uses the `.skeleton` class from theme.css which animates a gradient
 * sweep across the element. Variants for text lines, circles, and blocks.
 */
export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx("skeleton", className)} aria-hidden="true" />;
}

export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={clsx("space-y-2", className)} aria-hidden="true">
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          className={clsx("h-3", i === lines - 1 ? "w-2/3" : "w-full")}
        />
      ))}
    </div>
  );
}

export function SkeletonCard({ className }: { className?: string }) {
  return (
    <div className={clsx("glass rounded-2xl p-5 space-y-3", className)} aria-hidden="true">
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-3 w-full" />
      <Skeleton className="h-3 w-5/6" />
    </div>
  );
}

export function SkeletonRow({ className }: { className?: string }) {
  return (
    <div className={clsx("flex items-center gap-3 p-3", className)} aria-hidden="true">
      <Skeleton className="h-10 w-10 rounded-full" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-3 w-1/2" />
        <Skeleton className="h-2 w-3/4" />
      </div>
    </div>
  );
}
