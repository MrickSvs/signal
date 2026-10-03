"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { NAV_ITEMS, activeNavItem } from "./nav";

export function Sidebar() {
  const active = activeNavItem(usePathname());
  return (
    <aside className="flex w-56 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground">
      <Link href="/" className="flex h-14 items-center gap-2 border-b px-4">
        <span
          aria-hidden
          className="flex size-7 items-center justify-center rounded-md bg-signal text-signal-foreground"
        >
          <svg viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor">
            <path d="M1.5 8h2.5l2-4.5 4 9 2-4.5h2.5" strokeWidth="1.6" strokeLinejoin="round" />
          </svg>
        </span>
        <span className="text-base font-semibold tracking-tight">Signal</span>
        <span className="text-muted-foreground">· Jalon</span>
      </Link>
      <nav aria-label="Sections" className="flex flex-col gap-0.5 p-2">
        {NAV_ITEMS.map((item) => {
          const isActive = item.href === active.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "flex h-9 items-center gap-2.5 rounded-md px-2.5 font-medium transition-colors",
                isActive
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <item.icon
                aria-hidden
                className={cn("size-4", isActive ? "text-signal" : "text-muted-foreground")}
              />
              {item.label}
            </Link>
          );
        })}
      </nav>
      <p className="mt-auto p-4 text-[13px] leading-snug text-muted-foreground">
        Signal recommande, tu décides.
      </p>
    </aside>
  );
}
