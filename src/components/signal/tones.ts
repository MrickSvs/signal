// One color, one meaning, on every screen (ADR-033, ADR-039): blue for the PO (a decision to take,
// an override, a final choice), Signal green for what Signal estimates or sees rising, amber for a
// risk (fragile rank, changed context). Everything else stays neutral.

export const PILL_TONES = {
  po: "border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-200",
  signal: "border-signal/30 bg-signal-soft text-signal",
  risk: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200",
  neutral: "border-border text-muted-foreground",
} as const;

export const TEXT_TONES = {
  po: "text-blue-700 dark:text-blue-300",
  signal: "text-signal",
  risk: "text-amber-700 dark:text-amber-300",
} as const;
