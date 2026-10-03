// Human review of the development set (PLAN 1.4): 30 random feedbacks, then every feedback of
// the permissions pattern, the injection and the multi-topic edge case, then 30 random
// ground-truth labels next to their text.
// Usage: pnpm tsx scripts/review-sample.ts [--seed N]
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { FEEDBACK_FILES, type Feedback, type GroundTruth } from "./lib/feedbacks";
import { createRandom } from "./lib/random";

function show(f: Feedback, label?: string) {
  console.log(
    `\n━━━ ${f.id} · ${f.channel} · ${f.customer_id ?? "sans compte"} · J-${f.days_ago}${f.nps_score !== null ? ` · NPS ${f.nps_score}` : ""}${f.language === "en" ? " · EN" : ""}${label ? ` · ${label}` : ""}`,
  );
  console.log(`De : ${f.author_name} <${f.author_email}>`);
  if (f.subject) console.log(`Objet : ${f.subject}`);
  const text =
    f.raw_text.length > 1500
      ? `${f.raw_text.slice(0, 1500)}\n[… ${f.raw_text.length} caractères]`
      : f.raw_text;
  console.log(text || "(message vide)");
}

function describeTruth(t: GroundTruth): string {
  const items = t.expected_items
    .map(
      (i) =>
        `${i.pattern_id}${i.topic ? `/${i.topic}` : ""} → ${i.expected_type}${i.acceptable_types.length > 1 ? ` (ou ${i.acceptable_types.filter((x) => x !== i.expected_type).join(", ")})` : ""}, ${i.expected_area}${i.existing_feature ? ", fonctionnalité existante" : ""}`,
    )
    .join(" | ");
  const flags = [
    `sentiment ${t.expected_sentiment_sign > 0 ? "+" : t.expected_sentiment_sign < 0 ? "−" : "0"}`,
    t.churn_signal ? "churn" : "",
    t.is_injection ? "INJECTION" : "",
    t.edge_cases.join(" "),
  ].filter(Boolean);
  return `${items} · ${flags.join(" · ")}`;
}

function main() {
  const args = process.argv.slice(2);
  const seed = args.includes("--seed") ? Number(args[args.indexOf("--seed") + 1]) : 42;
  const random = createRandom(seed);
  const files = FEEDBACK_FILES.development;
  const feedbacks: Feedback[] = JSON.parse(readFileSync(files.data, "utf8"));
  const truth = new Map<string, GroundTruth>(
    (JSON.parse(readFileSync(files.truth, "utf8")) as GroundTruth[]).map((t) => [t.feedback_id, t]),
  );
  const byId = new Map(feedbacks.map((f) => [f.id, f]));

  console.log(`# 30 retours au hasard (seed ${seed})`);
  for (const f of random.shuffle(feedbacks).slice(0, 30)) show(f);

  const groups: [string, (t: GroundTruth) => boolean][] = [
    ["Permissions par projet et invités", (t) => t.patterns.includes("S2b")],
    ["Ticket piégé", (t) => t.is_injection],
    ["Retours multi-sujets", (t) => t.edge_cases.includes("E1")],
  ];
  for (const [title, match] of groups) {
    console.log(`\n\n# ${title}`);
    for (const t of [...truth.values()].filter(match))
      show(byId.get(t.feedback_id)!, describeTruth(t));
  }

  console.log(`\n\n# 30 étiquettes de vérité terrain à vérifier`);
  for (const t of random.shuffle([...truth.values()]).slice(0, 30)) {
    show(byId.get(t.feedback_id)!);
    console.log(`→ Vérité : ${describeTruth(t)}`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
