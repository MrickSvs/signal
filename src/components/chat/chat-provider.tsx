"use client";

import { createContext, useCallback, useContext, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import type { AgentEvent } from "@/agent";
import type { ChatHistoryMessage } from "@/agent/history";
import { createSseParser } from "@/lib/chat/sse";
import { pageContext, type ChatPageContext } from "@/lib/chat/suggestions";
import { loadThreadHistory, verifyAnswerIds } from "@/server/actions/chat";
import type { IdStatuses } from "./chat-markdown";

// State of the Signal chat panel (SPEC §12.9): the conversation, its streamed answers, the live
// trace of each turn and the check of the ids an answer cites. Shared through a context so that
// any page (the Digest's « En parler à Signal ») can open the panel with a pre-filled message.

type DoneEvent = Extract<AgentEvent, { type: "done" }>;

export type TraceTool = {
  id: string;
  name: string;
  args: string;
  status: "running" | "ok" | "error";
  startedAt: number;
  durationMs: number | null;
  models: string[];
  progress: string | null;
};

export type ChatTurn = {
  key: string;
  question: string;
  startedAt: number;
  endedAt: number | null;
  tools: TraceTool[];
  done: DoneEvent | null;
  status: "streaming" | "done" | "error";
};

export type ChatMessage =
  | { key: string; role: "user"; text: string }
  | {
      key: string;
      role: "assistant";
      text: string;
      status: "streaming" | "done" | "error";
      error: string | null;
      ids: IdStatuses;
      /** The turn that produced it (live only; a re-read conversation has no trace). */
      turnKey: string | null;
    }
  | { key: string; role: "summary" };

type ChatState = {
  open: boolean;
  setOpen: (open: boolean) => void;
  tab: "chat" | "trace";
  setTab: (tab: "chat" | "trace") => void;
  threadId: string | null;
  messages: ChatMessage[];
  turns: ChatTurn[];
  busy: boolean;
  loadingThread: boolean;
  threadError: string | null;
  draft: string;
  setDraft: (draft: string) => void;
  /** Bumped when a page pre-fills the input, so the panel focuses it. */
  focusSignal: number;
  context: ChatPageContext;
  send: (message: string) => Promise<void>;
  prefill: (message: string) => void;
  newThread: () => void;
  openThread: (id: string) => Promise<void>;
  threadsVersion: number;
};

const ChatContext = createContext<ChatState | null>(null);

export function useChat(): ChatState {
  const value = useContext(ChatContext);
  if (!value) throw new Error("useChat doit être utilisé dans <ChatProvider>.");
  return value;
}

let counter = 0;
const nextKey = (prefix: string) => `${prefix}-${Date.now()}-${++counter}`;

async function checkIds(
  text: string,
  threadId: string | null,
  record: boolean,
): Promise<IdStatuses> {
  const result = await verifyAnswerIds({ text, threadId, record }).catch(() => null);
  if (!result?.ok) return null;
  return Object.fromEntries([
    ...result.data.known.map((id) => [id, "known"] as const),
    ...result.data.unknown.map((id) => [id, "unknown"] as const),
  ]);
}

export function ChatProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(true);
  const [tab, setTab] = useState<"chat" | "trace">("chat");
  const [threadId, setThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [busy, setBusy] = useState(false);
  const [loadingThread, setLoadingThread] = useState(false);
  const [threadError, setThreadError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [focusSignal, setFocusSignal] = useState(0);
  const [threadsVersion, setThreadsVersion] = useState(0);
  const abort = useRef<AbortController | null>(null);
  // The search part is read when sending (useSearchParams would opt the layout out of prerender).
  const context = pageContext(pathname);

  const patchAssistant = useCallback(
    (
      key: string,
      patch: (m: Extract<ChatMessage, { role: "assistant" }>) => Partial<ChatMessage>,
    ) =>
      setMessages((all) =>
        all.map((m) =>
          m.key === key && m.role === "assistant" ? ({ ...m, ...patch(m) } as ChatMessage) : m,
        ),
      ),
    [],
  );
  const patchTurn = useCallback(
    (key: string, patch: (t: ChatTurn) => Partial<ChatTurn>) =>
      setTurns((all) => all.map((t) => (t.key === key ? { ...t, ...patch(t) } : t))),
    [],
  );

  const send = useCallback(
    async (raw: string) => {
      const message = raw.trim();
      if (!message || busy) return;
      setBusy(true);
      setDraft("");
      const turnKey = nextKey("turn");
      const answerKey = nextKey("a");
      setMessages((all) => [
        ...all,
        { key: nextKey("u"), role: "user", text: message },
        {
          key: answerKey,
          role: "assistant",
          text: "",
          status: "streaming",
          error: null,
          ids: null,
          turnKey,
        },
      ]);
      setTurns((all) => [
        {
          key: turnKey,
          question: message,
          startedAt: Date.now(),
          endedAt: null,
          tools: [],
          done: null,
          status: "streaming",
        },
        ...all,
      ]);

      let text = "";
      let currentThread = threadId;
      let failed: string | null = null;
      const controller = new AbortController();
      abort.current = controller;
      try {
        const response = await fetch("/api/agent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...(threadId ? { thread_id: threadId } : {}),
            message,
            page_context: pageContext(window.location.pathname, window.location.search),
          }),
          signal: controller.signal,
        });
        if (!response.ok || !response.body) {
          const body = (await response.json().catch(() => null)) as { error?: string } | null;
          throw new Error(body?.error ?? `Signal ne répond pas (${response.status}).`);
        }
        const parse = createSseParser((_type, data) => {
          const event = data as AgentEvent;
          switch (event.type) {
            case "token":
              text += event.text;
              patchAssistant(answerKey, () => ({ text }));
              break;
            case "tool_start":
              patchTurn(turnKey, (t) => ({
                tools: [
                  ...t.tools,
                  {
                    id: event.id,
                    name: event.name,
                    args: event.args,
                    status: "running",
                    startedAt: Date.now(),
                    durationMs: null,
                    models: [],
                    progress: null,
                  },
                ],
              }));
              break;
            case "tool_progress":
              patchTurn(turnKey, (t) => ({
                tools: t.tools.map((tool) =>
                  tool.id === event.id ? { ...tool, progress: event.message } : tool,
                ),
              }));
              break;
            case "tool_end":
              patchTurn(turnKey, (t) => ({
                tools: t.tools.map((tool) =>
                  tool.id === event.id
                    ? {
                        ...tool,
                        status: event.ok ? "ok" : "error",
                        durationMs: event.duration_ms,
                        models: event.models,
                        progress: null,
                      }
                    : tool,
                ),
              }));
              break;
            case "done":
              currentThread = event.thread_id;
              patchTurn(turnKey, () => ({ done: event, status: "done", endedAt: Date.now() }));
              break;
            case "error":
              failed = event.message;
              break;
          }
        });
        const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          parse(value);
        }
      } catch (error) {
        failed =
          error instanceof DOMException && error.name === "AbortError"
            ? "Réponse interrompue."
            : error instanceof Error
              ? error.message
              : "Signal ne répond pas.";
      } finally {
        abort.current = null;
      }

      if (currentThread && currentThread !== threadId) setThreadId(currentThread);
      setThreadsVersion((v) => v + 1);
      if (failed) {
        patchTurn(turnKey, (t) => ({ status: "error", endedAt: t.endedAt ?? Date.now() }));
        patchAssistant(answerKey, () => ({ status: "error", error: failed }));
      } else {
        patchAssistant(answerKey, () => ({ status: "done" }));
      }
      setBusy(false);
      // Ids become chips only after the check (CL-28); the unknown ones are journaled.
      // A failed check leaves them unchecked (dashed, not clickable) rather than all « inconnus ».
      const ids = text ? await checkIds(text, currentThread, true) : {};
      patchAssistant(answerKey, () => ({ ids }));
    },
    [busy, threadId, patchAssistant, patchTurn],
  );

  const prefill = useCallback((message: string) => {
    setOpen(true);
    setTab("chat");
    setDraft(message);
    setFocusSignal((n) => n + 1);
  }, []);

  const newThread = useCallback(() => {
    abort.current?.abort();
    setThreadId(null);
    setMessages([]);
    setThreadError(null);
    setTab("chat");
  }, []);

  const openThread = useCallback(async (id: string) => {
    abort.current?.abort();
    setThreadId(id);
    setMessages([]);
    setThreadError(null);
    setTab("chat");
    setLoadingThread(true);
    const result = await loadThreadHistory(id).catch(() => null);
    setLoadingThread(false);
    if (!result?.ok) {
      setThreadError(result?.message ?? "Impossible de relire cette conversation.");
      return;
    }
    const restored: ChatMessage[] = result.data.map((m: ChatHistoryMessage) =>
      m.role === "assistant"
        ? {
            key: nextKey("a"),
            role: "assistant",
            text: m.text,
            status: "done",
            error: null,
            ids: null,
            turnKey: null,
          }
        : m.role === "user"
          ? { key: nextKey("u"), role: "user", text: m.text }
          : { key: nextKey("s"), role: "summary" },
    );
    setMessages(restored);
    // Re-read answers are checked again, without journaling (they were when they streamed).
    for (const m of restored) {
      if (m.role !== "assistant") continue;
      void checkIds(m.text, id, false).then((ids) =>
        setMessages((all) =>
          all.map((x) => (x.key === m.key && x.role === "assistant" ? { ...x, ids } : x)),
        ),
      );
    }
  }, []);

  return (
    <ChatContext.Provider
      value={{
        open,
        setOpen,
        tab,
        setTab,
        threadId,
        messages,
        turns,
        busy,
        loadingThread,
        threadError,
        draft,
        setDraft,
        focusSignal,
        context,
        send,
        prefill,
        newThread,
        openThread,
        threadsVersion,
      }}
    >
      {children}
    </ChatContext.Provider>
  );
}
