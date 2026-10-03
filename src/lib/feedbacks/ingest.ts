// Messages of the « Ajouter un retour » modal for the failures of POST /api/pipeline/incremental.

export const BUSY_MESSAGE =
  "Un run du pipeline est en cours. Ton retour n'a pas été enregistré : réessaie dans un instant.";
export const FAILED_MESSAGE = "Le pipeline incrémental a échoué.";
export const OFFLINE_MESSAGE = "Le serveur ne répond pas. Réessaie dans un instant.";

/** Error to show for a non-2xx answer: 409 is a running run (CL-12), otherwise the route's message. */
export function ingestErrorMessage(status: number, body: unknown): string {
  if (status === 409) return BUSY_MESSAGE;
  if (body && typeof body === "object" && "error" in body && typeof body.error === "string") {
    return body.error;
  }
  return FAILED_MESSAGE;
}
