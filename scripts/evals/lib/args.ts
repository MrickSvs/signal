// Command-line options shared by the eval runners (CLAUDE.md rule 13).

export type EvalArgs = {
  sample?: number;
  full: boolean;
  /** Confirms a run whose estimated cost goes beyond COST_CONFIRM_EUR. */
  yes: boolean;
  flags: Set<string>;
  values: Map<string, string>;
};

/** Above this estimate, a run needs --yes (CLAUDE.md rule 13: about 1 €). */
export const COST_CONFIRM_EUR = 1;

/**
 * Parses `--flag` and `--option value`. `valued` lists the options that take a value; any other
 * unknown option is an error.
 */
export function parseEvalArgs(
  argv: readonly string[],
  spec: { flags?: readonly string[]; valued?: readonly string[] } = {},
): EvalArgs {
  const flags = new Set<string>();
  const values = new Map<string, string>();
  const known = new Set(["--full", "--yes", ...(spec.flags ?? [])]);
  const valued = new Set(["--sample", ...(spec.valued ?? [])]);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (valued.has(arg)) {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith("--")) throw new Error(`${arg} attend une valeur`);
      values.set(arg, v);
      i++;
    } else if (known.has(arg)) flags.add(arg);
    else throw new Error(`Option inconnue : ${arg}`);
  }
  const rawSample = values.get("--sample");
  let sample: number | undefined;
  if (rawSample !== undefined) {
    sample = Number(rawSample);
    if (!Number.isInteger(sample) || sample < 1)
      throw new Error("--sample attend un entier positif");
  }
  const full = flags.has("--full");
  if (full && sample !== undefined) throw new Error("--full et --sample ne vont pas ensemble");
  return { sample, full, yes: flags.has("--yes"), flags, values };
}

export function positiveInt(args: EvalArgs, flag: string, fallback: number): number {
  const raw = args.values.get(flag);
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) throw new Error(`${flag} attend un entier positif`);
  return n;
}

/** Sample size: --full → everything; --sample N; else the default (capped by the set size). */
export function sampleSize(args: EvalArgs, total: number, defaultSample: number): number {
  if (args.full) return total;
  return Math.min(total, args.sample ?? defaultSample);
}

const eur = (n: number) => `${n.toFixed(2).replace(".", ",")} €`;

/**
 * Announces the estimated cost; beyond the threshold without --yes, stops before any call.
 * Returns the line to print.
 */
export function checkCost(estimateEur: number, args: Pick<EvalArgs, "yes">, what: string): string {
  const line = `Coût estimé : ~${eur(estimateEur)} (${what})`;
  if (estimateEur > COST_CONFIRM_EUR && !args.yes) {
    throw new Error(
      `${line}. Au-delà de ${eur(COST_CONFIRM_EUR)} : relance avec --yes pour confirmer.`,
    );
  }
  return line;
}
