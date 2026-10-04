import { ChevronRight, FileText, Repeat, SlidersHorizontal, Sparkles } from "lucide-react";
import { Markdown } from "@/components/context/markdown";
import { Section } from "@/components/digest/sections";
import { getContextScreen } from "@/server/queries/context";

const PACK_DIR = "context/jalon";

function Fold({
  title,
  subtitle,
  path,
  children,
}: {
  title: string;
  subtitle?: string;
  path: string;
  children: React.ReactNode;
}) {
  return (
    <details className="group rounded-lg border bg-card">
      <summary className="flex cursor-pointer list-none items-start gap-2 px-4 py-3 [&::-webkit-details-marker]:hidden">
        <ChevronRight
          aria-hidden
          className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90"
        />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex flex-wrap items-baseline gap-x-3">
            <span className="font-medium">{title}</span>
            <code className="font-mono text-xs text-muted-foreground">{path}</code>
          </span>
          {subtitle && <span className="text-sm text-muted-foreground">{subtitle}</span>}
        </span>
      </summary>
      <div className="border-t px-4 pt-2 pb-4">{children}</div>
    </details>
  );
}

/** A snake_case key that may wrap after its underscores only. */
function BreakableKey({ value }: { value: string }) {
  return value.split("_").map((part, index) => (
    <span key={index}>
      {index > 0 && (
        <>
          _<wbr />
        </>
      )}
      {part}
    </span>
  ));
}

/** Context (SPEC §12.8): what Signal knows about Jalon, and which file to edit to change it. */
export default async function ContextPage() {
  const { documents, weighting, skills, adapt } = await getContextScreen();

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-8 px-8 py-6">
      <p className="max-w-3xl leading-relaxed text-muted-foreground">
        Tout ce que Signal sait de Jalon vit dans le pack{" "}
        <code className="font-mono">{PACK_DIR}</code>. Le pipeline et l&apos;agent relisent ces
        fichiers : les modifier change le comportement de Signal sans toucher au code. Cette page
        est en lecture ; on modifie les fichiers dans le repo.
      </p>

      <Section title="Fichiers du pack" count={documents.length}>
        <div className="flex flex-col gap-2">
          {documents.map((doc) => (
            <Fold key={doc.name} title={doc.file} path={`${PACK_DIR}/${doc.file}`}>
              <Markdown source={doc.content} />
            </Fold>
          ))}
        </div>
      </Section>

      <Section title="Pondération et seuils">
        <p className="flex items-start gap-2 text-sm text-muted-foreground">
          <SlidersHorizontal aria-hidden className="mt-0.5 size-4 shrink-0" />
          <span>
            <code className="font-mono">{PACK_DIR}/weighting.yaml</code> : tous les paramètres que
            le code utilise pour calculer Reach, Confidence, effort, MoSCoW, regroupement et
            alertes. Le fichier est validé au chargement : une valeur invalide bloque Signal avec un
            message clair.
          </span>
        </p>
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-left text-sm">
            <colgroup>
              <col className="w-[30%]" />
              <col className="w-[25%]" />
              <col />
            </colgroup>
            <thead className="bg-muted/50 text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Paramètre</th>
                <th className="px-3 py-2 font-medium">Valeur</th>
                <th className="px-3 py-2 font-medium">Note</th>
              </tr>
            </thead>
            {weighting.map((section) => (
              <tbody key={section.key}>
                <tr className="border-t bg-muted/30">
                  <th colSpan={3} scope="colgroup" className="px-3 py-2 text-left font-normal">
                    <code className="font-mono font-semibold">{section.key}</code>
                    {section.comment && (
                      <span className="ml-3 text-muted-foreground">{section.comment}</span>
                    )}
                  </th>
                </tr>
                {section.rows.map((row) => (
                  <tr key={row.key} className="border-t align-top">
                    <td className="px-3 py-2 pl-6 font-mono text-[13px]">
                      <BreakableKey value={row.key} />
                    </td>
                    <td className="px-3 py-2 font-mono text-[13px] tabular-nums">{row.value}</td>
                    <td className="px-3 py-2 text-muted-foreground">{row.comment ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        </div>
      </Section>

      <Section title="Skills" count={skills.length}>
        <p className="flex items-start gap-2 text-sm text-muted-foreground">
          <Sparkles aria-hidden className="mt-0.5 size-4 shrink-0" />
          <span>
            Les savoir-faire métier, chargés à la demande par le pipeline et par l&apos;agent. Une
            seule source : modifier une skill change les deux.
          </span>
        </p>
        <div className="flex flex-col gap-2">
          {skills.map((skill) => (
            <Fold
              key={skill.name}
              title={skill.name}
              subtitle={skill.description}
              path={`${PACK_DIR}/skills/${skill.name}/SKILL.md`}
            >
              <Markdown source={skill.content} />
            </Fold>
          ))}
        </div>
      </Section>

      {adapt && (
        <section className="rounded-lg border border-signal/30 bg-signal-soft/50 px-5 py-4">
          <h3 className="flex items-center gap-2 text-base font-semibold">
            <Repeat aria-hidden className="size-4 text-signal" />
            Adapter Signal à un autre produit
          </h3>
          <Markdown source={adapt} />
          <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
            <FileText aria-hidden className="size-3.5" />
            Source : <code className="font-mono">{PACK_DIR}/README.md</code>
          </p>
        </section>
      )}
    </div>
  );
}
