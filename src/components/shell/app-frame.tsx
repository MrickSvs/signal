"use client";

import { usePathname } from "next/navigation";
import { MessageSquare } from "lucide-react";
import { ChatPanel } from "@/components/chat/chat-panel";
import { ChatProvider, useChat } from "@/components/chat/chat-provider";
import { Button } from "@/components/ui/button";
import { activeNavItem } from "./nav";

/**
 * Header (page title + server-rendered status), main area and the collapsible Signal chat panel
 * on the right (SPEC §12.1, §12.9), shared by every page.
 */
export function AppFrame({
  status,
  children,
}: {
  status: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <ChatProvider>
      <Frame status={status}>{children}</Frame>
    </ChatProvider>
  );
}

function Frame({ status, children }: { status: React.ReactNode; children: React.ReactNode }) {
  const chat = useChat();
  const page = activeNavItem(usePathname());

  return (
    <div className="flex min-w-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-4 border-b px-6">
          <h1 className="text-lg font-semibold tracking-tight">{page.label}</h1>
          <div className="ml-auto flex items-center gap-3">
            {status}
            {!chat.open && (
              <Button variant="outline" onClick={() => chat.setOpen(true)}>
                <MessageSquare aria-hidden className="text-signal" />
                Signal
                {chat.busy && (
                  <span
                    aria-label="Réponse en cours"
                    className="size-1.5 animate-pulse rounded-full bg-signal"
                  />
                )}
              </Button>
            )}
          </div>
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto">{children}</main>
      </div>
      {chat.open && <ChatPanel />}
    </div>
  );
}
