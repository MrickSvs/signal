// Notion client (SPEC §11, CL-41): API version 2025-09-03 (data sources), ~3 requests per second
// through a limiter on fetch, and the SDK's own retries on 429 / 5xx, which honor Retry-After.
// Server only: the token never reaches the browser.
import {
  APIErrorCode,
  Client,
  ClientErrorCode,
  isNotionClientError,
  type RetryOptions,
} from "@notionhq/client";

export const NOTION_VERSION = "2025-09-03";
/** Notion's average limit is 3 requests per second (180 per minute). */
export const MIN_INTERVAL_MS = 340;
const RETRY: RetryOptions = { maxRetries: 3, initialRetryDelayMs: 1000, maxRetryDelayMs: 30_000 };

/** A Notion failure explained to Léa (shown with « Réessayer »). */
export class NotionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotionError";
  }
}

export type NotionConfig = {
  token: string;
  parentPageId: string | null;
  backlogDataSourceId: string | null;
  appBaseUrl: string;
};

/** Notion settings from the environment; a missing token is a clear error, not a crash. */
export function notionConfig(env: Record<string, string | undefined> = process.env): NotionConfig {
  const token = env.NOTION_TOKEN?.trim();
  if (!token) throw new NotionError("Notion n'est pas configuré : NOTION_TOKEN manque.");
  return {
    token,
    parentPageId: env.NOTION_PARENT_PAGE_ID?.trim() || null,
    backlogDataSourceId: env.NOTION_DS_BACKLOG?.trim() || null,
    appBaseUrl: env.APP_BASE_URL?.trim() || "http://localhost:3000",
  };
}

/**
 * Spaces the starts of the wrapped calls by `minIntervalMs` at least (pure scheduling: the clock
 * and the sleep are injected in tests).
 */
export function createLimiter(
  minIntervalMs = MIN_INTERVAL_MS,
  clock: { now: () => number; sleep: (ms: number) => Promise<void> } = {
    now: () => Date.now(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  },
) {
  let next = 0;
  return async function limit<T>(fn: () => Promise<T>): Promise<T> {
    const now = clock.now();
    const start = Math.max(now, next);
    next = start + minIntervalMs;
    if (start > now) await clock.sleep(start - now);
    return fn();
  };
}

// One limiter per process: every Notion call of the app or a script shares the budget.
const limit = createLimiter();

export function notionClient(config: Pick<NotionConfig, "token">): Client {
  return new Client({
    auth: config.token,
    notionVersion: NOTION_VERSION,
    retry: RETRY,
    fetch: (url, init) => limit(() => fetch(url, init)),
  });
}

/** A short, actionable message for a Notion failure (stored in push_error). */
export function notionErrorMessage(error: unknown): string {
  if (error instanceof NotionError) return error.message;
  if (isNotionClientError(error)) {
    switch (error.code) {
      case APIErrorCode.Unauthorized:
        return "Notion refuse le jeton (NOTION_TOKEN invalide ou révoqué).";
      case APIErrorCode.RestrictedResource:
      case APIErrorCode.ObjectNotFound:
        return "Base Notion introuvable : vérifie NOTION_DS_BACKLOG et que la page parente est partagée avec l'intégration.";
      case APIErrorCode.RateLimited:
        return "Notion limite le débit : réessaie dans une minute.";
      case APIErrorCode.ValidationError:
        return `Notion refuse la page (${error.message.slice(0, 200)}).`;
      case APIErrorCode.ServiceUnavailable:
      case APIErrorCode.ServiceOverload:
      case APIErrorCode.GatewayTimeout:
      case APIErrorCode.InternalServerError:
      case ClientErrorCode.RequestTimeout:
        return "Notion est indisponible pour l'instant : réessaie dans un moment.";
      default:
        return `Notion a répondu par une erreur (${error.message.slice(0, 200)}).`;
    }
  }
  const message = error instanceof Error ? error.message : String(error);
  return `Envoi vers Notion impossible (${message.slice(0, 200)}).`;
}
