import {
  FlaskConical,
  Inbox,
  Layers,
  ListOrdered,
  Newspaper,
  ScrollText,
  BookOpen,
  type LucideIcon,
} from "lucide-react";

export type NavItem = { href: string; label: string; icon: LucideIcon };

/** The seven sections of the cockpit (SPEC §12.1), in sidebar order. */
export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Digest", icon: Newspaper },
  { href: "/retours", label: "Retours", icon: Inbox },
  { href: "/insights", label: "Insights", icon: Layers },
  { href: "/priorisation", label: "Priorisation", icon: ListOrdered },
  { href: "/backlog", label: "Backlog", icon: ScrollText },
  { href: "/evals", label: "Évals", icon: FlaskConical },
  { href: "/contexte", label: "Contexte", icon: BookOpen },
];

/** Section matching a pathname (/insights/I-07 → Insights), Digest for the root. */
export function activeNavItem(pathname: string): NavItem {
  return (
    NAV_ITEMS.find((item) =>
      item.href === "/"
        ? pathname === "/"
        : pathname === item.href || pathname.startsWith(`${item.href}/`),
    ) ?? NAV_ITEMS[0]
  );
}
