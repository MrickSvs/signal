"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { MessageSquare, PanelRightClose } from "lucide-react";
import { Button } from "@/components/ui/button";
import { activeNavItem } from "./nav";

/**
 * Header (page title + server-rendered status), main area and the collapsible slot of the
 * Signal chat panel on the right (empty until step 4.2).
 */
export function AppFrame({
  status,
  children,
}: {
  status: React.ReactNode;
  children: React.ReactNode;
}) {
  const [chatOpen, setChatOpen] = useState(true);
  const page = activeNavItem(usePathname());

  return (
    <div className="flex min-w-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-4 border-b px-6">
          <h1 className="text-lg font-semibold tracking-tight">{page.label}</h1>
          <div className="ml-auto flex items-center gap-3">
            {status}
            {!chatOpen && (
              <Button variant="outline" onClick={() => setChatOpen(true)}>
                <MessageSquare aria-hidden className="text-signal" />
                Signal
              </Button>
            )}
          </div>
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto">{children}</main>
      </div>
      {chatOpen && (
        <aside
          aria-label="Chat avec Signal"
          className="flex w-[22rem] shrink-0 flex-col border-l bg-sidebar"
        >
          <div className="flex h-14 shrink-0 items-center justify-between border-b px-4">
            <span className="flex items-center gap-2 font-semibold">
              <MessageSquare aria-hidden className="size-4 text-signal" />
              Signal
            </span>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Replier le chat"
              onClick={() => setChatOpen(false)}
            >
              <PanelRightClose aria-hidden />
            </Button>
          </div>
          <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
            <p className="font-medium">Le chat arrive bientôt</p>
            <p className="leading-relaxed text-muted-foreground">
              Tu pourras ici interroger Signal sur la page ouverte, avec les preuves à l&apos;appui.
            </p>
          </div>
        </aside>
      )}
    </div>
  );
}
