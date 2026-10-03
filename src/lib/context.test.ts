import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import {
  CONTEXT_DOCUMENTS,
  ContextPackError,
  DEFAULT_CONTEXT_DIR,
  loadContextPack,
  parseArchitectureModules,
  parseWeighting,
} from "./context";

const weightingSource = () => readFile(path.join(DEFAULT_CONTEXT_DIR, "weighting.yaml"), "utf8");

/** Applies a mutation to the real weighting.yaml and re-serializes it. */
async function mutatedWeighting(mutate: (raw: Record<string, Record<string, unknown>>) => void) {
  const raw = parseYaml(await weightingSource());
  mutate(raw);
  return stringifyYaml(raw);
}

describe("loadContextPack (real pack)", () => {
  it("loads every document, the weighting and the modules", async () => {
    const pack = await loadContextPack();
    for (const doc of CONTEXT_DOCUMENTS) expect(pack.documents[doc].length).toBeGreaterThan(200);
    expect(pack.modules.map((m) => m.id)).toEqual([
      "taches",
      "tableau",
      "liste",
      "notifications",
      "permissions",
      "export",
      "champs_personnalises",
      "parametres",
    ]);
    expect(pack.modules.find((m) => m.id === "permissions")?.coupling).toBe("fort");
    expect(pack.modules.find((m) => m.id === "tableau")?.coupling).toBe("faible");
  });

  it("matches the parameters of SPEC §8 and §10.10", async () => {
    const { weighting: w } = await loadContextPack();
    expect(w.reach.extrapolation_factors).toEqual({
      free: 6,
      pro: 4,
      business: 2.5,
      enterprise: 1.5,
    });
    expect(w.reach.default_mode).toBe("comptes");
    expect(w.reach.unidentified_account).toEqual({ comptes: 1, mrr: 0 });
    expect(w.source_weights).toEqual({ client_direct: 1, support: 1, interne: 0.5 });
    expect(w.confidence.levels.map((l) => [l.min, l.value])).toEqual([
      [0.7, 1],
      [0.45, 0.8],
      [0, 0.5],
    ]);
    expect(w.impact.scale).toEqual([3, 2, 1, 0.5, 0.25]);
    expect(w.effort.velocity_points_per_dev_week).toBe(3);
    expect(w.effort.tshirt_upper_bounds).toEqual({ S: 3, M: 8, L: 20 });
    expect(w.moscow.rule_order[0]).toBe("engagement_contractuel");
    expect(w.moscow.must_capacity_share).toBe(0.6);
    expect(w.clustering.distance_threshold).toBe(0.35);
    expect(w.clustering.run_matching_jaccard).toBe(0.5);
    expect(w.clustering.watch_queue_min_items).toBe(3);
    expect(w.triage.truncation_chars).toBe(6000);
    expect(w.overrides.context_changed_share).toBe(0.3);
    expect(w.alerts.critical_bug_window_hours).toBe(48);
    // Roadmap capacity of SPEC §4.6: 5 devs × 12 weeks × 70 % = 42 person-weeks.
    const { developers, quarter_weeks, roadmap_share } = w.capacity;
    expect(developers * quarter_weeks * roadmap_share).toBeCloseTo(42);
  });

  it("lists the existing features used to detect CL-05", async () => {
    const { documents } = await loadContextPack();
    expect(documents.product).toMatch(/## Fonctionnalités existantes/);
    expect(documents.product).toMatch(/Filtrer la liste .*par assigné/);
  });

  it("names every architecture module in product.md", async () => {
    const pack = await loadContextPack();
    for (const { id } of pack.modules) expect(pack.documents.product).toContain(`[${id}]`);
  });

  it("keeps every pack file under 150 lines and free of absolute dates", async () => {
    const files = (await readdir(DEFAULT_CONTEXT_DIR)).filter((f) => /\.(md|yaml)$/.test(f));
    expect(files.length).toBe(CONTEXT_DOCUMENTS.length + 2); // + weighting.yaml + README.md
    for (const file of files) {
      const content = await readFile(path.join(DEFAULT_CONTEXT_DIR, file), "utf8");
      expect(content.split("\n").length, file).toBeLessThan(150);
      expect(content, file).not.toMatch(/\b20\d\d\b/);
      expect(content, file).not.toMatch(
        /\b(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\b/i,
      );
    }
  });
});

describe("parseWeighting", () => {
  it("rejects invalid YAML", () => {
    expect(() => parseWeighting("reach: [unclosed")).toThrow(ContextPackError);
  });

  it("rejects an unknown key (typo protection)", async () => {
    const source = await mutatedWeighting((raw) => {
      raw.reach.extrapolation_factor = 2;
    });
    expect(() => parseWeighting(source)).toThrow(/extrapolation_factor/);
  });

  it("rejects confidence weights that do not sum to 1", async () => {
    const source = await mutatedWeighting((raw) => {
      (raw.confidence.weights as Record<string, number>).volume = 0.5;
    });
    expect(() => parseWeighting(source)).toThrow(/sum to 1/);
  });

  it("rejects a MoSCoW rule order with a missing or repeated rule", async () => {
    const source = await mutatedWeighting((raw) => {
      raw.moscow.rule_order = [
        "hors_strategie",
        "hors_strategie",
        "signal_churn",
        "bug_critique",
        "quartiles",
      ];
    });
    expect(() => parseWeighting(source)).toThrow(/exactly once/);
  });

  it("rejects unsorted confidence levels", async () => {
    const source = await mutatedWeighting((raw) => {
      raw.confidence.levels = [
        { min: 0.45, value: 0.8 },
        { min: 0.7, value: 1 },
        { min: 0, value: 0.5 },
      ];
    });
    expect(() => parseWeighting(source)).toThrow(ContextPackError);
  });

  it("rejects a non-positive extrapolation factor", async () => {
    const source = await mutatedWeighting((raw) => {
      (raw.reach.extrapolation_factors as Record<string, number>).free = 0;
    });
    expect(() => parseWeighting(source)).toThrow(ContextPackError);
  });
});

describe("parseArchitectureModules", () => {
  const table = (rows: string) =>
    `# Carte\n\n## Modules\n\n| Identifiant | Module | Couplage |\n| --- | --- | --- |\n${rows}\n\n## Dépendances\n\n| \`taches\` | x | y |\n`;

  it("reads only the Modules section", () => {
    expect(parseArchitectureModules(table("| `taches` | Tâches | fort |"))).toEqual([
      { id: "taches", name: "Tâches", coupling: "fort" },
    ]);
  });

  it("rejects a missing section, an unknown coupling and duplicates", () => {
    expect(() => parseArchitectureModules("# Carte\n")).toThrow(/Modules/);
    expect(() => parseArchitectureModules(table("| `taches` | Tâches | énorme |"))).toThrow(
      /taches/,
    );
    expect(() =>
      parseArchitectureModules(table("| `taches` | Tâches | fort |\n| `taches` | Bis | faible |")),
    ).toThrow(/duplicate/);
  });
});

describe("loadContextPack (errors)", () => {
  let dir: string | undefined;
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("names the missing file", async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "context-pack-"));
    await writeFile(path.join(dir, "weighting.yaml"), await weightingSource());
    await expect(loadContextPack(dir)).rejects.toThrow(/product\.md/);
  });
});
