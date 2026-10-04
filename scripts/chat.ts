// Terminal chat with Signal (PLAN 4.1): talk to the agent without the UI.
// Usage: pnpm chat [--thread <uuid>] [--page /insights --entity I-07] [-m "<message>"]
//   without -m: interactive (empty line or « /quit » to leave) ; with -m: one turn, then exit.
// Cost: a Sonnet turn is ~0.02 to 0.10 € (more if add_feedback runs the incremental pipeline).
// Run through `pnpm chat` (tsx --conditions=react-server: the server queries guard against
// client bundles with « server-only »).
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { pathToFileURL } from "node:url";
import { runTurn, type AgentEvent } from "@/agent";
import type { PageContext } from "@/agent/briefing";
import { getAgentRuntime } from "@/agent/runtime";
import { getScriptDb } from "@/lib/db/script-client";
import { formatCost } from "@/lib/format";
import { initTracing, shutdownTracing } from "@/lib/llm/tracing";

export type ChatArgs = { threadId: string; page: PageContext | null; message: string | null };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseChatArgs(argv: string[], newId: () => string = randomUUID): ChatArgs {
  const value = (flag: string) => {
    const i = argv.indexOf(flag);
    if (i === -1) return undefined;
    const v = argv[i + 1];
    if (!v || v.startsWith("--")) throw new Error(`Valeur manquante pour ${flag}`);
    return v;
  };
  const known = new Set(["--thread", "--page", "--entity", "-m"]);
  const unknown = argv.filter(
    (a, i) => a.startsWith("-") && !known.has(a) && !known.has(argv[i - 1]),
  );
  if (unknown.length) throw new Error(`Option inconnue : ${unknown.join(", ")}`);
  const thread = value("--thread");
  if (thread && !UUID.test(thread)) throw new Error("--thread attend un UUID de conversation");
  const page = value("--page");
  const entity = value("--entity");
  if (entity && !page) throw new Error("--entity demande --page");
  return {
    threadId: thread ?? newId(),
    page: page ? { page, entity_id: entity ?? null } : null,
    message: value("-m") ?? null,
  };
}

const dim = (text: string) => `\x1b[2m${text}\x1b[0m`;

function printEvent(event: AgentEvent): void {
  switch (event.type) {
    case "token":
      process.stdout.write(event.text);
      break;
    case "tool_start":
      process.stdout.write(dim(`\n  → ${event.name} ${event.args}\n`));
      break;
    case "tool_end":
      process.stdout.write(
        dim(
          `  ${event.ok ? "✓" : "✗"} ${event.name} · ${(event.duration_ms / 1000).toFixed(1)} s` +
            (event.models.length ? ` · ${event.models.join(", ")}` : "") +
            "\n",
        ),
      );
      break;
    case "interrupt":
      process.stdout.write(`\n[validation attendue] ${JSON.stringify(event.value)}\n`);
      break;
    case "done":
      process.stdout.write(
        dim(
          `\n\n${formatCost(event.cost_eur)} · ${event.tokens_in} tokens en entrée, ${event.tokens_out} en sortie` +
            (event.partial ? " · réponse partielle" : "") +
            (event.langfuse_url ? `\n${event.langfuse_url}` : "") +
            "\n",
        ),
      );
      break;
    case "error":
      process.stdout.write(`\nErreur : ${event.message}\n`);
  }
}

async function main() {
  const args = parseChatArgs(process.argv.slice(2));
  const db = getScriptDb(); // loads .env
  initTracing();
  const { agent, deps } = await getAgentRuntime(db);
  console.log(
    dim(`Conversation ${args.threadId} (reprendre : pnpm chat --thread ${args.threadId})`),
  );
  const turn = (message: string) =>
    runTurn(agent, deps, { threadId: args.threadId, message, page: args.page }, printEvent);

  if (args.message) {
    await turn(args.message);
    return;
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    for (;;) {
      const message = (await rl.question("\nLéa › ")).trim();
      if (!message || message === "/quit") break;
      process.stdout.write("\nSignal › ");
      await turn(message);
    }
  } finally {
    rl.close();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main()
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await shutdownTracing();
      // The checkpointer's pool keeps the process alive.
      process.exit();
    });
}
