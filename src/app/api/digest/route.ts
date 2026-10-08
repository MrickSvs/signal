import { after } from "next/server";
import { loadContextPack } from "@/lib/context";
import { getDb } from "@/lib/db/client";
import { getDemoNow } from "@/lib/demo-now";
import { encodeEvent, type DigestStreamEvent } from "@/lib/digest/stream";
import { flushTracing } from "@/lib/llm/tracing";
import { loadSkill } from "@/lib/skills";
import { generateDigest } from "@/pipeline/daily";
import { PipelineBusyError, withPipelineLock } from "@/pipeline/lock";

// One reasoning call (~20 s), plus up to 30 s waiting for the pipeline lock (CL-12).
export const maxDuration = 60;

/**
 * POST /api/digest → application/x-ndjson: « Générer » or « Régénérer » from the Digest screen
 * (SPEC §12.2). Rewrites the digest shown over its period (ADR-043), or writes the first one, and
 * streams each step with its figures so the screen shows what Signal is doing (ADR-044). The run
 * ends server-side even if the page is left.
 */
export async function POST() {
  after(flushTracing);
  const encoder = new TextEncoder();
  const started = Date.now();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (event: DigestStreamEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(encodeEvent(event)));
        } catch {
          closed = true;
        }
      };
      try {
        const [pack, triage, riceScoring, moscow, digest] = await Promise.all([
          loadContextPack(),
          loadSkill("triage-taxonomy"),
          loadSkill("rice-scoring"),
          loadSkill("moscow"),
          loadSkill("digest"),
        ]);
        const result = await withPipelineLock(() =>
          generateDigest(
            getDb(),
            {
              pack,
              skills: {
                triage: triage.content,
                riceScoring: riceScoring.content,
                moscow: moscow.content,
                digest: digest.content,
              },
              now: getDemoNow(),
            },
            {
              samePeriod: true,
              onProgress: (event) => send({ type: "progress", at: Date.now() - started, event }),
            },
          ),
        );
        send({
          type: "done",
          result: {
            id: result.id,
            writer: result.writer,
            costEur: result.costEur,
            durationMs: Date.now() - started,
          },
        });
      } catch (error) {
        if (!(error instanceof PipelineBusyError)) console.error("[digest]", error);
        send({
          type: "error",
          message:
            error instanceof PipelineBusyError
              ? error.message
              : "La génération du digest a échoué. Réessaie dans un instant.",
        });
      } finally {
        if (!closed) controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
