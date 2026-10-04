// Builds the agent with its real dependencies (database, context pack, skills, checkpointer),
// once per process: shared by the /api/agent route and the terminal chat (scripts/chat.ts).
import type { Db } from "@/lib/db/create";
import { loadContextPack } from "@/lib/context";
import { getDemoNow } from "@/lib/demo-now";
import { listSkills, loadSkill } from "@/lib/skills";
import { withPipelineLock } from "@/pipeline/lock";
import { getCheckpointer } from "./checkpointer";
import { createSignalAgent, type SignalAgent } from "./index";
import type { AgentDeps } from "./tools";

export type AgentRuntime = { agent: SignalAgent; deps: AgentDeps };

const globalState = globalThis as typeof globalThis & { __signalAgent?: Promise<AgentRuntime> };

export function getAgentRuntime(db: Db): Promise<AgentRuntime> {
  globalState.__signalAgent ??= (async () => {
    const [pack, skills, triage, riceScoring, moscow, checkpointer] = await Promise.all([
      loadContextPack(),
      listSkills(),
      loadSkill("triage-taxonomy"),
      loadSkill("rice-scoring"),
      loadSkill("moscow"),
      getCheckpointer(),
    ]);
    const deps: AgentDeps = {
      db,
      pack,
      skills: { triage: triage.content, riceScoring: riceScoring.content, moscow: moscow.content },
      now: () => getDemoNow(),
      withLock: (fn) => withPipelineLock(fn),
    };
    return { agent: createSignalAgent({ deps, skills, checkpointer }), deps };
  })().catch((error) => {
    globalState.__signalAgent = undefined;
    throw error;
  });
  return globalState.__signalAgent;
}
