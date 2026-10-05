import type { BacklogDeps } from "@/services/backlog";
import type { AgentDeps, TurnContext } from "./shared";

/** What the backlog service needs, from the agent's dependencies and the turn (source: chat). */
export function backlogDeps(
  deps: AgentDeps,
  ctx: TurnContext | undefined,
  progress: (message: string) => void,
): BacklogDeps {
  return {
    pack: deps.pack,
    skills: { riceScoring: deps.skills.riceScoring, moscow: deps.skills.moscow },
    now: deps.now(),
    source: "chat",
    withLock: deps.withLock,
    runCost: ctx?.runCost,
    background: deps.background,
    progress,
    ...deps.backlog,
  };
}
