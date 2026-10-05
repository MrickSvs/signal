// Builds the agent with its real dependencies (database, context pack, skills, checkpointer),
// once per process: shared by the /api/agent route and the terminal chat (scripts/chat.ts).
import { after } from "next/server";
import type { Db } from "@/lib/db/create";
import { loadContextPack } from "@/lib/context";
import { getDemoNow } from "@/lib/demo-now";
import { listSkills, loadSkill, type SkillSummary } from "@/lib/skills";
import { withPipelineLock } from "@/pipeline/lock";
import { getCheckpointer } from "./checkpointer";
import { createSignalAgent, type SignalAgent } from "./index";
import { flushTracing } from "@/lib/llm/tracing";
import { investigateAll } from "./investigate";
import type { AgentDeps } from "./tools";

export type AgentRuntime = { agent: SignalAgent; deps: AgentDeps };

const globalState = globalThis as typeof globalThis & { __signalAgent?: Promise<AgentRuntime> };

/**
 * The agent's dependencies without the agent itself: the investigations of the CLI and of the
 * pipeline routes use them. An alert created by add_feedback starts its investigation at once,
 * in the background (SPEC §10.10): the chat turn goes on meanwhile.
 */
export async function loadAgentDeps(db: Db): Promise<{ deps: AgentDeps; skills: SkillSummary[] }> {
  const [pack, skills, triage, riceScoring, moscow] = await Promise.all([
    loadContextPack(),
    listSkills(),
    loadSkill("triage-taxonomy"),
    loadSkill("rice-scoring"),
    loadSkill("moscow"),
  ]);
  const deps: AgentDeps = {
    db,
    pack,
    skills: { triage: triage.content, riceScoring: riceScoring.content, moscow: moscow.content },
    now: () => getDemoNow(),
    withLock: (fn) => withPipelineLock(fn),
    background: runAfterResponse,
    onAlerts: (alertIds) => {
      if (alertIds.length === 0) return;
      const running = investigateAll(alertIds, deps, { skills });
      // The traces are sent once the dossiers are written (the route's own flush ran earlier).
      runAfterResponse(() => running.then(flushTracing));
    },
  };
  return { deps, skills };
}

export function getAgentRuntime(db: Db): Promise<AgentRuntime> {
  globalState.__signalAgent ??= (async () => {
    const [{ deps, skills }, checkpointer] = await Promise.all([
      loadAgentDeps(db),
      getCheckpointer(),
    ]);
    return { agent: createSignalAgent({ deps, skills, checkpointer }), deps };
  })().catch((error) => {
    globalState.__signalAgent = undefined;
    throw error;
  });
  return globalState.__signalAgent;
}

const pending = new Set<Promise<void>>();

/**
 * Work after the answer (the quality badge of a drafting): Next's after() inside a request, so the
 * function is not frozen before it ends; outside one (terminal chat), a promise that
 * settleBackgroundTasks awaits before the process exits.
 */
function runAfterResponse(task: () => Promise<void>): void {
  try {
    after(task);
  } catch {
    const running = task().finally(() => pending.delete(running));
    pending.add(running);
  }
}

/**
 * Investigates the alerts created by a pipeline run outside the chat (incremental route, cron,
 * CLI): started now; inside a request, after() keeps the function alive until they end.
 */
export async function investigateInBackground(db: Db, alertIds: readonly string[]): Promise<void> {
  if (alertIds.length === 0) return;
  const { deps } = await loadAgentDeps(db);
  deps.onAlerts?.([...alertIds]);
}

/** Waits for the work started outside a request (scripts/chat.ts, before exiting). */
export async function settleBackgroundTasks(): Promise<void> {
  while (pending.size) await Promise.allSettled([...pending]);
}
