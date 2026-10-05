"use client";

import { useEffect, useRef, useState } from "react";
import {
  Activity,
  ArrowUp,
  Check,
  ExternalLink,
  History,
  Lightbulb,
  Loader2,
  MessageSquare,
  PanelRightClose,
  Plus,
  TriangleAlert,
  X,
} from "lucide-react";
import { ModelBadge } from "@/components/signal/badges";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { suggestionsFor } from "@/lib/chat/suggestions";
import { formatDuration, loadedSkills } from "@/lib/chat/trace";
import { formatCost, formatDateTime, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { loadThreads } from "@/server/actions/chat";
import type { ThreadSummary } from "@/server/queries/threads";
import { ApprovalCard } from "./approval-card";
import { ChatMarkdown } from "./chat-markdown";
import { useChat, type ChatMessage, type ChatTurn, type TraceTool } from "./chat-provider";

/** The Signal panel on the right of every page (SPEC §12.1, §12.9): chat and live trace. */
export function ChatPanel() {
  const chat = useChat();
  return (
    <aside
      aria-label="Chat avec Signal"
      className="flex w-[22rem] shrink-0 flex-col border-l bg-sidebar"
    >
      <div className="flex h-14 shrink-0 items-center gap-1 border-b px-3">
        <span className="mr-1 flex items-center gap-2 font-semibold">
          <MessageSquare aria-hidden className="size-4 text-signal" />
          Signal
        </span>
        <div role="tablist" aria-label="Vue du panneau" className="flex rounded-md bg-muted p-0.5">
          {(["chat", "trace"] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={chat.tab === tab}
              onClick={() => chat.setTab(tab)}
              className={cn(
                "flex items-center gap-1 rounded px-2 py-0.5 text-[13px] font-medium text-muted-foreground transition-colors",
                chat.tab === tab && "bg-background text-foreground shadow-sm ring-1 ring-border",
              )}
            >
              {tab === "chat" ? "Chat" : "Trace"}
              {tab === "trace" && chat.busy && (
                <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-signal" />
              )}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center">
          <ThreadsMenu />
          <Button
            variant="ghost"
            size="icon"
            aria-label="Nouvelle conversation"
            title="Nouvelle conversation"
            onClick={chat.newThread}
          >
            <Plus aria-hidden />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Replier le chat"
            onClick={() => chat.setOpen(false)}
          >
            <PanelRightClose aria-hidden />
          </Button>
        </div>
      </div>
      {chat.tab === "chat" ? <ChatView /> : <TraceView />}
    </aside>
  );
}

// Conversations ------------------------------------------------------------------------------

function ThreadsMenu() {
  const chat = useChat();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "error"; message: string }
    | { status: "done"; threads: ThreadSummary[] }
  >({ status: "loading" });

  useEffect(() => {
    if (!open) return;
    let live = true;
    void loadThreads().then((result) => {
      if (!live) return;
      setState(
        result.ok
          ? { status: "done", threads: result.data }
          : { status: "error", message: result.message },
      );
    });
    return () => {
      live = false;
    };
  }, [open, chat.threadsVersion]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label="Conversations"
        title="Conversations"
        className="inline-flex size-8 items-center justify-center rounded-md text-foreground hover:bg-muted"
      >
        <History aria-hidden className="size-4" />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 gap-1 p-1.5">
        <p className="px-2 pt-1 pb-1.5 text-[13px] font-medium text-muted-foreground">
          Conversations
        </p>
        {state.status === "loading" && (
          <div className="flex flex-col gap-1.5 p-2" aria-busy="true">
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        )}
        {state.status === "error" && <p className="p-2 text-destructive">{state.message}</p>}
        {state.status === "done" && state.threads.length === 0 && (
          <p className="p-2 text-muted-foreground">Aucune conversation pour l&apos;instant.</p>
        )}
        {state.status === "done" && state.threads.length > 0 && (
          <ul className="max-h-80 overflow-y-auto">
            {state.threads.map((thread) => (
              <li key={thread.id}>
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    void chat.openThread(thread.id);
                  }}
                  className={cn(
                    "flex w-full flex-col items-start rounded-md px-2 py-1.5 text-left hover:bg-muted",
                    thread.id === chat.threadId && "bg-signal-soft",
                  )}
                >
                  <span className="line-clamp-1 font-medium">{thread.title ?? "Sans titre"}</span>
                  <span className="text-[13px] text-muted-foreground">
                    {formatDateTime(thread.last_message_at)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}

// Chat ---------------------------------------------------------------------------------------

function ChatView() {
  const chat = useChat();
  const bottom = useRef<HTMLDivElement>(null);
  const last = chat.messages.at(-1);
  const lastText = last?.role === "assistant" ? last.text.length : 0;

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [chat.messages.length, lastText, chat.approval]);

  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3" aria-live="polite">
        {chat.loadingThread ? (
          <div
            className="flex flex-col gap-3"
            aria-busy="true"
            aria-label="Chargement de la conversation"
          >
            <Skeleton className="ml-auto h-8 w-2/3" />
            <Skeleton className="h-20 w-full" />
          </div>
        ) : chat.threadError ? (
          <p className="text-destructive">{chat.threadError}</p>
        ) : chat.messages.length === 0 ? (
          <EmptyChat />
        ) : (
          <div className="flex flex-col gap-3">
            {chat.messages.map((message) => (
              <MessageView key={message.key} message={message} />
            ))}
            {chat.approval && <ApprovalCard key={chat.approval.interrupt_id} />}
          </div>
        )}
        <div ref={bottom} />
      </div>
      <Composer />
    </>
  );
}

function EmptyChat() {
  const chat = useChat();
  return (
    <div className="flex h-full flex-col justify-end gap-3">
      <div>
        <p className="font-medium">Demande à Signal</p>
        <p className="leading-relaxed text-muted-foreground">
          Il lit la page ouverte, cite ses preuves et ne décide rien à ta place.
        </p>
      </div>
      <ul className="flex flex-col gap-1.5">
        {suggestionsFor(chat.context).map((suggestion) => (
          <li key={suggestion}>
            <button
              type="button"
              disabled={chat.busy}
              onClick={() => void chat.send(suggestion)}
              className="w-full rounded-lg border bg-background px-3 py-2 text-left leading-snug transition-colors hover:border-signal/50 hover:bg-signal-soft disabled:opacity-50"
            >
              {suggestion}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function MessageView({ message }: { message: ChatMessage }) {
  const chat = useChat();
  if (message.role === "summary") {
    return (
      <p className="text-center text-[13px] text-muted-foreground">
        Début de conversation résumé pour rester sous la limite de contexte.
      </p>
    );
  }
  if (message.role === "user") {
    return (
      <p className="ml-6 self-end rounded-lg bg-signal-soft px-3 py-2 leading-relaxed whitespace-pre-wrap">
        {message.text}
      </p>
    );
  }
  const turn = chat.turns.find((t) => t.key === message.turnKey) ?? null;
  const running = turn?.tools.findLast((t) => t.status === "running");
  return (
    <div className="flex flex-col gap-1.5">
      {message.text && <ChatMarkdown text={message.text} statuses={message.ids} />}
      {message.status === "streaming" && (
        <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
          <Loader2 aria-hidden className="size-3.5 animate-spin" />
          {running ? (
            <span className="truncate">
              <span className="font-mono">{running.name}</span>
              {running.progress ? ` · ${running.progress}` : "…"}
            </span>
          ) : message.text ? (
            "Rédaction…"
          ) : (
            "Signal réfléchit…"
          )}
        </p>
      )}
      {message.status === "error" && (
        <p className="flex items-start gap-1.5 text-[13px] text-destructive">
          <TriangleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          {message.error}
        </p>
      )}
      {turn?.done && (
        <p className="flex flex-wrap items-center gap-x-2 text-[13px] text-muted-foreground">
          <span
            title={`${formatNumber(turn.done.tokens_in, 0)} tokens en entrée, ${formatNumber(turn.done.tokens_out, 0)} en sortie`}
          >
            {formatCost(turn.done.cost_eur)}
          </span>
          <span>· {formatDuration(turnDuration(turn))}</span>
          {turn.tools.length > 0 && (
            <button
              type="button"
              onClick={() => chat.setTab("trace")}
              className="underline-offset-4 hover:text-foreground hover:underline"
            >
              · {turn.tools.length} outil{turn.tools.length > 1 ? "s" : ""}
            </button>
          )}
          {message.ids && Object.values(message.ids).includes("unknown") && (
            <span className="text-destructive">· ID inconnu signalé</span>
          )}
        </p>
      )}
    </div>
  );
}

function Composer() {
  const chat = useChat();
  const input = useRef<HTMLTextAreaElement>(null);
  const [showSuggestions, setShowSuggestions] = useState(false);

  useEffect(() => {
    if (chat.focusSignal === 0) return;
    const el = input.current;
    el?.focus();
    el?.setSelectionRange(el.value.length, el.value.length);
  }, [chat.focusSignal]);

  function submit() {
    if (!chat.draft.trim() || chat.busy) return;
    void chat.send(chat.draft);
  }

  return (
    <form
      className="flex shrink-0 flex-col gap-2 border-t p-3"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      {showSuggestions && chat.messages.length > 0 && (
        <ul className="flex flex-col gap-1">
          {suggestionsFor(chat.context).map((suggestion) => (
            <li key={suggestion}>
              <button
                type="button"
                disabled={chat.busy}
                onClick={() => {
                  setShowSuggestions(false);
                  void chat.send(suggestion);
                }}
                className="w-full truncate rounded-md border bg-background px-2 py-1 text-left text-[13px] hover:border-signal/50 hover:bg-signal-soft disabled:opacity-50"
              >
                {suggestion}
              </button>
            </li>
          ))}
        </ul>
      )}
      <Textarea
        ref={input}
        value={chat.draft}
        onChange={(event) => chat.setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            submit();
          }
        }}
        placeholder="Pose ta question à Signal…"
        aria-label="Message pour Signal"
        maxLength={20_000}
        className="max-h-40 min-h-10 resize-none bg-background text-sm"
      />
      <div className="flex items-center justify-between gap-2">
        {chat.messages.length > 0 ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-pressed={showSuggestions}
            onClick={() => setShowSuggestions((v) => !v)}
          >
            {showSuggestions ? <X aria-hidden /> : <Lightbulb aria-hidden />}
            Suggestions
          </Button>
        ) : (
          <span className="text-[13px] text-muted-foreground">Entrée pour envoyer</span>
        )}
        <Button type="submit" size="sm" disabled={!chat.draft.trim() || chat.busy}>
          {chat.busy ? <Loader2 aria-hidden className="animate-spin" /> : <ArrowUp aria-hidden />}
          Envoyer
        </Button>
      </div>
    </form>
  );
}

// Trace --------------------------------------------------------------------------------------

function turnDuration(turn: ChatTurn): number {
  return (turn.endedAt ?? turn.startedAt) - turn.startedAt;
}

function TraceView() {
  const chat = useChat();
  if (chat.turns.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
        <Activity aria-hidden className="size-5 text-muted-foreground" />
        <p className="font-medium">Pas encore de trace</p>
        <p className="leading-relaxed text-muted-foreground">
          Pose une question : chaque outil appelé, chaque skill chargée et le coût du tour
          s&apos;affichent ici, en direct.
        </p>
      </div>
    );
  }
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      {chat.turns.map((turn) => (
        <TurnTrace key={turn.key} turn={turn} />
      ))}
    </div>
  );
}

function TurnTrace({ turn }: { turn: ChatTurn }) {
  const skills = loadedSkills(turn.tools);
  return (
    <section className="flex flex-col gap-2 border-b px-4 py-3">
      <div className="flex items-start gap-2">
        <TurnStatusIcon status={turn.status} />
        <p className="line-clamp-2 font-medium leading-snug">{turn.question}</p>
      </div>
      {turn.tools.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">
          {turn.status === "streaming"
            ? "Aucun outil pour l'instant."
            : "Réponse sans appel d'outil."}
        </p>
      ) : (
        <ol className="flex flex-col gap-1.5">
          {turn.tools.map((tool) => (
            <ToolRow key={tool.id} tool={tool} />
          ))}
        </ol>
      )}
      {skills.length > 0 && (
        <p className="text-[13px]">
          <span className="text-muted-foreground">Skills chargées : </span>
          <span className="font-mono">{skills.join(", ")}</span>
        </p>
      )}
      {turn.done && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted-foreground">
          <ModelBadge model={turn.done.model} />
          <span className="font-medium text-foreground tabular-nums">
            {formatCost(turn.done.cost_eur)}
          </span>
          <span className="tabular-nums">
            {formatNumber(turn.done.tokens_in, 0)} → {formatNumber(turn.done.tokens_out, 0)} tokens
          </span>
          {turn.done.partial && <span className="text-destructive">réponse partielle</span>}
          {turn.done.langfuse_url && (
            <a
              href={turn.done.langfuse_url}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-0.5 font-medium text-signal underline-offset-4 hover:underline"
            >
              Langfuse
              <ExternalLink aria-hidden className="size-3" />
            </a>
          )}
        </div>
      )}
    </section>
  );
}

function TurnStatusIcon({ status }: { status: ChatTurn["status"] }) {
  if (status === "streaming")
    return (
      <Loader2 aria-label="En cours" className="mt-0.5 size-4 shrink-0 animate-spin text-signal" />
    );
  if (status === "error")
    return (
      <TriangleAlert aria-label="Erreur" className="mt-0.5 size-4 shrink-0 text-destructive" />
    );
  return <Check aria-label="Terminé" className="mt-0.5 size-4 shrink-0 text-signal" />;
}

function ToolRow({ tool }: { tool: TraceTool }) {
  return (
    <li className="rounded-md border bg-background px-2.5 py-1.5">
      <div className="flex items-center gap-2">
        {tool.status === "running" ? (
          <Loader2 aria-label="En cours" className="size-3.5 shrink-0 animate-spin text-signal" />
        ) : tool.status === "ok" ? (
          <Check aria-label="Réussi" className="size-3.5 shrink-0 text-signal" />
        ) : (
          <TriangleAlert aria-label="En erreur" className="size-3.5 shrink-0 text-destructive" />
        )}
        <span className="font-mono text-[13px] font-medium">{tool.name}</span>
        <span className="ml-auto text-[13px] text-muted-foreground tabular-nums">
          {tool.durationMs !== null ? (
            formatDuration(tool.durationMs)
          ) : (
            <Elapsed since={tool.startedAt} />
          )}
        </span>
      </div>
      <p className="mt-0.5 truncate font-mono text-[12px] text-muted-foreground" title={tool.args}>
        {tool.args}
      </p>
      {tool.progress && <p className="mt-0.5 text-[13px] text-signal">{tool.progress}…</p>}
      {tool.models.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1">
          {tool.models.map((model) => (
            <ModelBadge key={model} model={model} />
          ))}
        </div>
      )}
    </li>
  );
}

/** Seconds since a tool started, refreshed while it runs (long operations show progress). */
function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, []);
  return <>{formatDuration(Math.max(0, now - since))}</>;
}
