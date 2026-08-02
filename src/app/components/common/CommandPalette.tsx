import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { LucideIcon } from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "../ui/command";

export type CommandPaletteItem = {
  to: string;
  label: string;
  icon: LucideIcon;
  group?: string;
};

/**
 * Global ⌘K / Ctrl+K quick-jump palette. Fed a flat list of nav items by
 * the layout that renders it; groups items by their `group` field.
 */
export function CommandPalette({ items }: { items: CommandPaletteItem[] }) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  const groups = items.reduce<Record<string, CommandPaletteItem[]>>((acc, item) => {
    const key = item.group ?? "Navigate";
    (acc[key] ??= []).push(item);
    return acc;
  }, {});

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm text-muted-foreground transition-colors hover:border-primary/40"
      >
        <SearchIcon />
        <span>Search</span>
        <kbd className="ml-auto flex items-center gap-0.5 rounded border border-border px-1.5 py-0.5 text-[10px] font-medium">
          ⌘K
        </kbd>
      </button>
      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput placeholder="Jump to a page…" />
        <CommandList>
          <CommandEmpty>No matches.</CommandEmpty>
          {Object.entries(groups).map(([group, groupItems]) => (
            <CommandGroup key={group} heading={group}>
              {groupItems.map((item) => (
                <CommandItem
                  key={item.to}
                  value={`${item.label} ${item.to}`}
                  onSelect={() => {
                    setOpen(false);
                    navigate(item.to);
                  }}
                >
                  <item.icon className="h-4 w-4" aria-hidden="true" />
                  <span>{item.label}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          ))}
        </CommandList>
      </CommandDialog>
    </>
  );
}

function SearchIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.35-4.35" />
    </svg>
  );
}
