import { LangfuseClient } from "@langfuse/client";
import { CallbackHandler } from "@langfuse/langchain";
import { LangfuseSpanProcessor } from "@langfuse/otel";
import { getActiveTraceId, propagateAttributes, startActiveObservation } from "@langfuse/tracing";
import { context, ROOT_CONTEXT } from "@opentelemetry/api";
import { NodeSDK } from "@opentelemetry/sdk-node";

// One shared OpenTelemetry setup for the app (src/instrumentation.ts) and the CLI scripts.
// Without Langfuse keys (tests, CI) nothing is registered: spans go to the no-op tracer.

type TracingState = { sdk: NodeSDK; processor: LangfuseSpanProcessor };
const globalState = globalThis as typeof globalThis & { __signalTracing?: TracingState };

export function isTracingConfigured(): boolean {
  return Boolean(process.env.LANGFUSE_PUBLIC_KEY && process.env.LANGFUSE_SECRET_KEY);
}

/** Starts the Langfuse span processor once per process. Call it after the environment is loaded. */
export function initTracing(): void {
  if (globalState.__signalTracing || !isTracingConfigured()) return;
  const processor = new LangfuseSpanProcessor({
    environment:
      process.env.LANGFUSE_TRACING_ENVIRONMENT ?? process.env.VERCEL_ENV ?? "development",
    release: process.env.VERCEL_GIT_COMMIT_SHA,
  });
  const sdk = new NodeSDK({ serviceName: "signal", spanProcessors: [processor] });
  sdk.start();
  globalState.__signalTracing = { sdk, processor };
}

/** Sends buffered spans. In a route handler, call it inside next/server `after()`. */
export async function flushTracing(): Promise<void> {
  await globalState.__signalTracing?.processor.forceFlush();
}

/** Flushes and stops tracing: required at the end of every CLI script. */
export async function shutdownTracing(): Promise<void> {
  const state = globalState.__signalTracing;
  if (!state) return;
  globalState.__signalTracing = undefined;
  await state.sdk.shutdown();
}

/** Where a call belongs: pipeline run, step (node or tool) and the entity it works on. */
export type TraceContext = {
  runId?: string;
  step: string;
  entity?: string;
  /** Chat thread id; defaults to the run id so a run groups its traces as one session. */
  sessionId?: string;
  tags?: string[];
  metadata?: Record<string, string>;
  /**
   * A trace of its own even when started inside another one (an alert investigation launched by
   * add_feedback during a chat turn): without it, the chat turn's trace would be renamed.
   */
  root?: boolean;
};

/**
 * Opens a trace (root observation) for one unit of work: a run, a pipeline node, an agent turn.
 * `name` must be stable and verb-first (e.g. "triage-feedback"): dashboards and evaluators target it.
 * Nested LLM calls made with `langfuseCallbacks()` are attached to this trace automatically.
 */
export async function withTrace<T>(
  name: string,
  ctx: TraceContext,
  input: unknown,
  fn: () => Promise<T>,
  toOutput: (result: T) => unknown = (result) => result,
): Promise<T> {
  if (ctx.root) {
    return context.with(ROOT_CONTEXT, () =>
      withTrace(name, { ...ctx, root: false }, input, fn, toOutput),
    );
  }
  return startActiveObservation(name, async (span) => {
    span.update({ input });
    const metadata: Record<string, string> = { step: ctx.step, ...ctx.metadata };
    if (ctx.runId) metadata.run_id = ctx.runId;
    if (ctx.entity) metadata.entity = ctx.entity;
    return propagateAttributes(
      {
        traceName: name,
        sessionId: ctx.sessionId ?? ctx.runId,
        tags: ctx.tags,
        metadata,
      },
      async () => {
        try {
          const result = await fn();
          span.update({ output: toOutput(result) });
          return result;
        } catch (error) {
          span.update({ level: "ERROR", statusMessage: errorMessage(error) });
          throw error;
        }
      },
    );
  });
}

/**
 * A child observation inside the active trace (a pipeline node within its run): unlike withTrace,
 * it does not rename the trace nor change its session.
 */
export async function withSpan<T>(
  name: string,
  input: unknown,
  fn: () => Promise<T>,
  toOutput: (result: T) => unknown = (result) => result,
): Promise<T> {
  return startActiveObservation(name, async (span) => {
    span.update({ input });
    try {
      const result = await fn();
      span.update({ output: toOutput(result) });
      return result;
    } catch (error) {
      span.update({ level: "ERROR", statusMessage: errorMessage(error) });
      throw error;
    }
  });
}

/** LangChain callbacks that record each model call as a generation (model, tokens, cost). */
export function langfuseCallbacks(): CallbackHandler[] {
  return isTracingConfigured() ? [new CallbackHandler()] : [];
}

export function currentTraceId(): string | undefined {
  return getActiveTraceId();
}

let client: LangfuseClient | undefined;

/** Link to a trace in the Langfuse UI (stored in pipeline_runs.langfuse_url, alerts.langfuse_url…). */
export async function traceUrl(traceId: string | undefined): Promise<string | null> {
  if (!traceId || !isTracingConfigured()) return null;
  client ??= new LangfuseClient();
  return client.getTraceUrl(traceId);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
