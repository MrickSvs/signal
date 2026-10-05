// Terminal chat with Signal (PLAN 4.1): talk to the agent without the UI.
// Usage: pnpm chat [--thread <uuid>] [--page /insights --entity I-07] [-m "<message>"]
//        pnpm chat --thread <uuid> --resume approve|reject[:raison]
//   without -m: interactive (empty line or « /quit » to leave), approval cards answered inline
//   (v / m / r) ; with -m: one turn, then exit ; --resume answers the pending approval card.
// Cost: a Sonnet turn is ~0.02 to 0.10 € (more if add_feedback runs the incremental pipeline).
// Run through `pnpm chat` (tsx --conditions=react-server: the server queries guard against
// client bundles with « server-only »).
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { pathToFileURL } from "node:url";
import { pendingApproval, runTurn, type AgentEvent } from "@/agent";
import { withTargets, type CardDecision, type PendingApproval } from "@/agent/approval";
import type { PageContext } from "@/agent/briefing";
import { resumeTurn } from "@/agent/resume";
import { getAgentRuntime, settleBackgroundTasks } from "@/agent/runtime";
import { getScriptDb } from "@/lib/db/script-client";
import { formatCost } from "@/lib/format";
import { initTracing, shutdownTracing } from "@/lib/llm/tracing";

export type ChatArgs = {
  threadId: string;
  page: PageContext | null;
  message: string | null;
  /** Answer to the pending approval card of --thread. */
  resume: CardDecision | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseChatArgs(argv: string[], newId: () => string = randomUUID): ChatArgs {
  const value = (flag: string) => {
    const i = argv.indexOf(flag);
    if (i === -1) return undefined;
    const v = argv[i + 1];
    if (!v || v.startsWith("--")) throw new Error(`Valeur manquante pour ${flag}`);
    return v;
  };
  const known = new Set(["--thread", "--page", "--entity", "-m", "--resume"]);
  const unknown = argv.filter(
    (a, i) => a.startsWith("-") && !known.has(a) && !known.has(argv[i - 1]),
  );
  if (unknown.length) throw new Error(`Option inconnue : ${unknown.join(", ")}`);
  const thread = value("--thread");
  if (thread && !UUID.test(thread)) throw new Error("--thread attend un UUID de conversation");
  const page = value("--page");
  const entity = value("--entity");
  if (entity && !page) throw new Error("--entity demande --page");
  const resume = parseResume(value("--resume"));
  if (resume && !thread) throw new Error("--resume demande --thread");
  if (resume && value("-m")) throw new Error("--resume et -m ne vont pas ensemble");
  return {
    threadId: thread ?? newId(),
    page: page ? { page, entity_id: entity ?? null } : null,
    message: value("-m") ?? null,
    resume,
  };
}

/** « approve » or « reject[:raison] » (an edit needs the interactive mode). */
export function parseResume(raw: string | undefined): CardDecision | null {
  if (raw === undefined) return null;
  if (raw === "approve") return { type: "approve" };
  const reject = /^reject(?::([\s\S]*))?$/.exec(raw);
  if (reject) return { type: "reject", ...(reject[1]?.trim() ? { reason: reject[1].trim() } : {}) };
  throw new Error("--resume attend approve ou reject[:raison]");
}

let lastApproval: PendingApproval | null = null;

function printApproval(approval: PendingApproval): void {
  process.stdout.write("\n\n┌ Validation attendue\n");
  for (const action of approval.actions) {
    const title = action.target_title ? ` — ${action.target_title}` : "";
    process.stdout.write(`│ ${action.description}${title}\n`);
    const { reason, signal_position } = action.args as {
      reason?: string;
      signal_position?: string;
    };
    if (reason) process.stdout.write(`│ Raison : ${reason}\n`);
    if (signal_position) process.stdout.write(`│ Désaccord de Signal : ${signal_position}\n`);
    for (const line of action.preview?.split("\n") ?? []) process.stdout.write(`│   ${line}\n`);
  }
  process.stdout.write("└\n");
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
      lastApproval = event.approval;
      printApproval(event.approval);
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
  const answer = async (approval: PendingApproval, decisions: CardDecision[]) => {
    lastApproval = null;
    process.stdout.write("\nSignal › ");
    await resumeTurn(
      agent,
      deps,
      { threadId: args.threadId, interruptId: approval.interrupt_id, decisions, page: args.page },
      printEvent,
    );
  };

  if (args.resume) {
    const pending = await pendingApproval(agent, args.threadId);
    if (!pending) throw new Error("Aucune carte d'approbation en attente dans cette conversation.");
    const approval = await withTargets(db, pending.approval);
    printApproval(approval);
    await answer(
      approval,
      approval.actions.map(() => args.resume!),
    );
    return;
  }
  if (args.message) {
    await turn(args.message);
    return;
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    for (;;) {
      while (lastApproval) {
        const approval: PendingApproval = lastApproval;
        const choice = (
          await rl.question("Valider (v), modifier (m), refuser (r) ou écrire : ")
        ).trim();
        if (choice === "v")
          await answer(
            approval,
            approval.actions.map(() => ({ type: "approve" })),
          );
        else if (choice === "r") {
          const reason = (await rl.question("Raison (facultative) : ")).trim();
          await answer(
            approval,
            approval.actions.map(() => ({ type: "reject", ...(reason ? { reason } : {}) })),
          );
        } else if (choice === "m") {
          const decisions: CardDecision[] = [];
          for (const action of approval.actions) {
            const value = (
              await rl.question(`Nouvelle valeur (${String(action.args.value)}) : `)
            ).trim();
            const reason = (await rl.question("Raison : ")).trim();
            const numeric = value !== "" && !Number.isNaN(Number(value));
            decisions.push({
              type: "edit",
              args: {
                ...action.args,
                ...(value ? { value: numeric ? Number(value) : value } : {}),
                ...(reason ? { reason } : {}),
              },
            });
          }
          await answer(approval, decisions);
        } else if (choice) {
          // Léa writes instead: the card is dropped, nothing is applied.
          lastApproval = null;
          process.stdout.write("\nSignal › ");
          await turn(choice);
        }
      }
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
      // The quality badge of a drafting runs after the answer.
      await settleBackgroundTasks();
      await shutdownTracing();
      // The checkpointer's pool keeps the process alive.
      process.exit();
    });
}
