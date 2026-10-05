"use client";

import { MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useChat } from "./chat-provider";

/** « En parler à Signal » (SPEC §12.2): opens the chat with a message ready to send or edit. */
export function AskSignalButton({ prompt }: { prompt: string }) {
  const chat = useChat();
  return (
    <Button variant="outline" onClick={() => chat.prefill(prompt)}>
      <MessageSquare aria-hidden />
      En parler à Signal
    </Button>
  );
}
