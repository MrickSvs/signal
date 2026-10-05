"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { AgentEvent } from "@/agent";
import type { CardDecision, PendingApproval } from "@/agent/approval";
import type { ChatHistoryMessage } from "@/agent/history";
import { discussAlertMessage } from "@/lib/alerts";
import { createSseParser } from "@/lib/chat/sse";
import { pageContext, type ChatPageContext } from "@/lib/chat/suggestions";
import { loadOpenAlerts } from "@/server/actions/alerts";
import { loadPendingApproval, loadThreadHistory, verifyAnswerIds } from "@/server/actions/chat";
import type { OpenAlert } from "@/server/queries/shell";
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
  /** Sends a message; `alertId` puts an alert's dossier in the turn's briefing. */
  send: (message: string, alertId?: string | null) => Promise<void>;
  /** The approval card waiting for Léa (SPEC §10.6), and her answer to it. */
  approval: PendingApproval | null;
  answerApproval: (decisions: CardDecision[], label: string) => Promise<void>;
  prefill: (message: string) => void;
  newThread: () => void;
  openThread: (id: string) => Promise<void>;
  threadsVersion: number;
  /** Open alerts raised while the conversation is open (cards in the chat, SPEC §10.10). */
  alerts: OpenAlert[];
  /** « En parler à Signal » from an alert: pre-filled message, the dossier joins the briefing. */
  discussAlert: (alert: OpenAlert) => void;
  /** « Faire l'action proposée »: sends the action to Signal with the alert's dossier in context. */
  sendAboutAlert: (message: string, alertId: string) => void;
};

/** Polling of the alerts while a conversation is open (an investigation takes ~30 s). */
const ALERTS_POLL_MS = 5_000;

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
  const [approval, setApproval] = useState<PendingApproval | null>(null);
  const [alerts, setAlerts] = useState<OpenAlert[]>([]);
  const [alertFocus, setAlertFocus] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const router = useRouter();
  // Alerts shown in the chat: those created since the panel opened (the older ones are in the badge).
  const [openedAt] = useState(() => new Date().toISOString());
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

  /**
   * Streams one turn (a message to /api/agent, or the answer to a card to /api/agent/resume):
   * `shown` is what appears as Léa's message, `body` what the route receives.
   */
  const stream = useCallback(
    async (
      url: string,
      shown: string,
      body: Record<string, unknown>,
      alertId: string | null = null,
    ) => {
      setBusy(true);
      const message = shown;
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
      let refused: number | null = null;
      const controller = new AbortController();
      abort.current = controller;
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...(threadId ? { thread_id: threadId } : {}),
            ...body,
            page_context: {
              ...pageContext(window.location.pathname, window.location.search),
              ...(alertId ? { alert_id: alertId } : {}),
            },
          }),
          signal: controller.signal,
        });
        if (!response.ok || !response.body) {
          refused = response.status;
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
            case "interrupt":
              setApproval(event.approval);
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
      return { refused };
    },
    [threadId, patchAssistant, patchTurn],
  );

  const send = useCallback(
    async (raw: string, alertId: string | null = alertFocus) => {
      const message = raw.trim();
      if (!message || busy) return;
      setDraft("");
      setAlertFocus(null);
      // Writing instead of answering the card drops it: nothing is applied (SPEC §8.10).
      setApproval(null);
      await stream("/api/agent", message, { message }, alertId);
    },
    [busy, stream, alertFocus],
  );

  const answerApproval = useCallback(
    async (decisions: CardDecision[], label: string) => {
      if (!approval || !threadId || busy) return;
      const card = approval;
      setApproval(null);
      const { refused } = await stream("/api/agent/resume", label, {
        interrupt_id: card.interrupt_id,
        decisions,
      });
      // An invalid edit (400) leaves the card open with the error above it; a stale card (409) goes.
      if (refused === 400) setApproval(card);
    },
    [approval, threadId, busy, stream],
  );

  const prefill = useCallback((message: string) => {
    setOpen(true);
    setTab("chat");
    setDraft(message);
    setFocusSignal((n) => n + 1);
  }, []);

  const discussAlert = useCallback(
    (alert: OpenAlert) => {
      setAlertFocus(alert.id);
      prefill(discussAlertMessage(alert));
    },
    [prefill],
  );

  const sendAboutAlert = useCallback(
    (message: string, alertId: string) => {
      setOpen(true);
      setTab("chat");
      void send(message, alertId);
    },
    [send],
  );

  // Alert cards in the chat while a conversation is open; the header badge is refreshed when a
  // dossier changes state (the layout is a server component).
  const conversationOpen = threadId !== null || messages.length > 0;
  const signature = useRef("");
  useEffect(() => {
    if (!conversationOpen) return;
    let stopped = false;
    const poll = async () => {
      const open = await loadOpenAlerts().catch(() => null);
      if (stopped || !open) return;
      const next = open.map((a) => `${a.id}:${a.status}:${a.dossier_status}`).join("|");
      if (signature.current && next !== signature.current) router.refresh();
      signature.current = next;
      setAlerts(open.filter((a) => a.created_at >= openedAt).toReversed());
    };
    void poll();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void poll();
    }, ALERTS_POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [conversationOpen, openedAt, router]);

  const newThread = useCallback(() => {
    abort.current?.abort();
    setThreadId(null);
    setMessages([]);
    setApproval(null);
    setThreadError(null);
    setTab("chat");
  }, []);

  const openThread = useCallback(async (id: string) => {
    abort.current?.abort();
    setThreadId(id);
    setMessages([]);
    setThreadError(null);
    setTab("chat");
    setApproval(null);
    setLoadingThread(true);
    const [result, pending] = await Promise.all([
      loadThreadHistory(id).catch(() => null),
      loadPendingApproval(id).catch(() => null),
    ]);
    if (pending?.ok) setApproval(pending.data);
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
        approval,
        answerApproval,
        prefill,
        newThread,
        openThread,
        threadsVersion,
        alerts,
        discussAlert,
        sendAboutAlert,
      }}
    >
      {children}
    </ChatContext.Provider>
  );
}
