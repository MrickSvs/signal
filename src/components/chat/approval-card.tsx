"use client";

import { useState } from "react";
import { Check, Pencil, ShieldCheck, X } from "lucide-react";
import type { ApprovalAction, CardDecision } from "@/agent/approval";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  KIND_LABEL,
  MOSCOW_VALUES,
  REVIEW_ACTIONS,
  type DecisionKind,
  type ReviewAction,
} from "@/lib/decisions/apply-decision";
import { STATEMENT_MAX, TITLE_MAX } from "@/lib/insights/review";
import { useChat } from "./chat-provider";

// Approval card of the chat (SPEC §10.6): the exact content of a decision Signal proposes, and
// Léa's choice — Valider, Modifier (pre-filled form), Refuser (optional reason). A proposed insight
// born in the conversation gets its own wording (SPEC §8.10): Accepter, Reformuler, Rejeter, Plus
// tard. Nothing is written before her click; writing in the chat instead drops the card.

const FIELD = "h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm";
const LABEL = "text-[13px] font-medium text-muted-foreground";

type Args = {
  kind?: DecisionKind;
  target?: string;
  param?: string;
  value?: number | string;
  title?: string;
  problem_statement?: string;
  into?: string;
  reason?: string;
  signal_position?: string;
};

const REVIEW_LABEL: Record<ReviewAction, string> = {
  accepter: "Accepter",
  reformuler: "Reformuler",
  fusionner: "Fusionner",
  rejeter: "Rejeter",
};

/** A proposed insight to review, as add_feedback makes it born (« Nouveau sujet proposé »). */
const isNewTopic = (args: Args) => args.kind === "insight_review" && args.value === "accepter";

export function ApprovalCard() {
  const chat = useChat();
  const approval = chat.approval;
  const [choices, setChoices] = useState<Record<number, { decision: CardDecision; label: string }>>(
    {},
  );
  if (!approval) return null;

  function decide(index: number, decision: CardDecision, label: string) {
    const next = { ...choices, [index]: { decision, label } };
    if (Object.keys(next).length < approval!.actions.length) {
      setChoices(next);
      return;
    }
    setChoices({});
    const ordered = approval!.actions.map((_, i) => next[i]);
    void chat.answerApproval(
      ordered.map((c) => c.decision),
      ordered.map((c) => c.label).join("\n"),
    );
  }

  return (
    <section
      aria-label="Validation attendue"
      className="flex flex-col gap-2 rounded-lg border border-signal/40 bg-background p-3"
    >
      <p className="flex items-center gap-1.5 text-[13px] font-medium text-signal">
        <ShieldCheck aria-hidden className="size-3.5" />
        Ta validation · rien n&apos;est écrit avant ton clic
      </p>
      {approval.actions.map((action, i) =>
        choices[i] ? (
          <p key={i} className="text-[13px] text-muted-foreground">
            {choices[i].label}
          </p>
        ) : (
          <ActionView
            key={i}
            action={action}
            disabled={chat.busy}
            onDecide={(decision, label) => decide(i, decision, label)}
          />
        ),
      )}
    </section>
  );
}

function ActionView({
  action,
  disabled,
  onDecide,
}: {
  action: ApprovalAction;
  disabled: boolean;
  onDecide: (decision: CardDecision, label: string) => void;
}) {
  const args = action.args as Args;
  const [mode, setMode] = useState<
    { kind: "idle" } | { kind: "edit"; preset: Partial<Args> } | { kind: "reject" }
  >({ kind: "idle" });
  const newTopic = isNewTopic(args);
  const can = (type: CardDecision["type"]) => action.allowed.includes(type);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-1">
        <span className="w-fit rounded bg-muted px-1.5 py-0.5 text-[12px] font-medium text-muted-foreground">
          {newTopic ? "Nouveau sujet proposé" : args.kind ? KIND_LABEL[args.kind] : action.tool}
        </span>
        <p className="leading-snug font-medium">{action.description}</p>
        {action.target_title && (
          <p className="leading-snug text-muted-foreground">
            {args.target} · {action.target_title}
          </p>
        )}
        {newTopic && action.target_statement && (
          <p className="leading-snug text-muted-foreground">{action.target_statement}</p>
        )}
        {args.reason && (
          <p className="leading-snug">
            <span className="text-muted-foreground">Raison : </span>
            {args.reason}
          </p>
        )}
        {args.signal_position && (
          <p className="rounded-md bg-amber-500/10 px-2 py-1 leading-snug text-amber-900 dark:text-amber-200">
            <span className="font-medium">Désaccord de Signal (journalisé) : </span>
            {args.signal_position}
          </p>
        )}
      </div>

      {mode.kind === "idle" && newTopic && (
        <div className="flex flex-wrap gap-1.5">
          <Button
            size="sm"
            disabled={disabled}
            onClick={() => onDecide({ type: "approve" }, `✓ Accepté : ${args.target}`)}
          >
            <Check aria-hidden /> Accepter
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={disabled}
            onClick={() =>
              setMode({
                kind: "edit",
                preset: {
                  value: "reformuler",
                  title: action.target_title ?? "",
                  problem_statement: action.target_statement ?? "",
                },
              })
            }
          >
            <Pencil aria-hidden /> Reformuler
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={disabled}
            onClick={() => setMode({ kind: "edit", preset: { value: "rejeter" } })}
          >
            Rejeter
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={disabled}
            title="L'insight reste « à valider » dans l'écran Insights"
            onClick={() =>
              onDecide(
                { type: "reject", reason: "Plus tard : reste à valider" },
                `Plus tard : ${args.target} reste à valider`,
              )
            }
          >
            Plus tard
          </Button>
        </div>
      )}

      {mode.kind === "idle" && !newTopic && (
        <div className="flex flex-wrap gap-1.5">
          {can("approve") && (
            <Button
              size="sm"
              disabled={disabled}
              onClick={() => onDecide({ type: "approve" }, `✓ Validé : ${action.description}`)}
            >
              <Check aria-hidden /> Valider
            </Button>
          )}
          {can("edit") && (
            <Button
              size="sm"
              variant="outline"
              disabled={disabled}
              onClick={() => setMode({ kind: "edit", preset: {} })}
            >
              <Pencil aria-hidden /> Modifier
            </Button>
          )}
          {can("reject") && (
            <Button
              size="sm"
              variant="outline"
              disabled={disabled}
              onClick={() => setMode({ kind: "reject" })}
            >
              <X aria-hidden /> Refuser
            </Button>
          )}
        </div>
      )}

      {mode.kind === "edit" && (
        <EditForm
          args={{ ...args, ...mode.preset }}
          disabled={disabled}
          onCancel={() => setMode({ kind: "idle" })}
          onSubmit={(edited, label) => onDecide({ type: "edit", args: edited }, label)}
        />
      )}

      {mode.kind === "reject" && (
        <RejectForm
          disabled={disabled}
          onCancel={() => setMode({ kind: "idle" })}
          onSubmit={(reason) =>
            onDecide(
              { type: "reject", ...(reason ? { reason } : {}) },
              `✗ Refusé : ${action.description}${reason ? ` (${reason})` : ""}`,
            )
          }
        />
      )}
    </div>
  );
}

function RejectForm({
  disabled,
  onCancel,
  onSubmit,
}: {
  disabled: boolean;
  onCancel: () => void;
  onSubmit: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(reason.trim());
      }}
    >
      <label className="flex flex-col gap-1">
        <span className={LABEL}>Raison du refus (facultative, journalisée)</span>
        <Textarea
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          maxLength={500}
          rows={2}
          autoFocus
        />
      </label>
      <div className="flex gap-1.5">
        <Button size="sm" type="submit" variant="destructive" disabled={disabled}>
          Refuser
        </Button>
        <Button size="sm" type="button" variant="ghost" onClick={onCancel}>
          Annuler
        </Button>
      </div>
    </form>
  );
}

/** Pre-filled form of a decision: only its value fields change, never its kind or target. */
function EditForm({
  args,
  disabled,
  onCancel,
  onSubmit,
}: {
  args: Args;
  disabled: boolean;
  onCancel: () => void;
  onSubmit: (args: Args, label: string) => void;
}) {
  const [value, setValue] = useState(String(args.value ?? ""));
  const [title, setTitle] = useState(args.title ?? "");
  const [statement, setStatement] = useState(args.problem_statement ?? "");
  const [into, setInto] = useState(args.into ?? "");
  const [reason, setReason] = useState(args.reason ?? "");
  const kind = args.kind;

  function submit() {
    const edited: Args = { ...args, reason: reason.trim() || undefined };
    if (kind === "override") edited.value = Number(value.replace(",", "."));
    else edited.value = value;
    if (kind === "insight_review") {
      edited.title = value === "reformuler" ? title.trim() : undefined;
      edited.problem_statement = value === "reformuler" ? statement.trim() : undefined;
      edited.into = value === "fusionner" ? into.trim().toUpperCase() : undefined;
    }
    const clean = Object.fromEntries(
      Object.entries(edited).filter(([, v]) => v !== undefined),
    ) as Args;
    const what =
      kind === "insight_review"
        ? `${REVIEW_LABEL[value as ReviewAction] ?? value} ${args.target}`
        : `${args.target} → ${value}`;
    onSubmit(clean, `✎ Modifié et validé : ${what}`);
  }

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      {kind === "override" && (
        <label className="flex flex-col gap-1">
          <span className={LABEL}>
            {args.param === "confidence" ? "Confidence (%)" : `Valeur (${args.param ?? ""})`}
          </span>
          <input
            className={FIELD}
            inputMode="decimal"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            required
            autoFocus
          />
        </label>
      )}
      {kind === "moscow" && (
        <label className="flex flex-col gap-1">
          <span className={LABEL}>MoSCoW final</span>
          <select className={FIELD} value={value} onChange={(e) => setValue(e.target.value)}>
            {MOSCOW_VALUES.map((m) => (
              <option key={m} value={m}>
                {m === "wont" ? "Won't" : m[0].toUpperCase() + m.slice(1)}
              </option>
            ))}
          </select>
        </label>
      )}
      {kind === "validation" && (
        <label className="flex flex-col gap-1">
          <span className={LABEL}>Décision</span>
          <select className={FIELD} value={value} onChange={(e) => setValue(e.target.value)}>
            <option value="valide">Valider le brouillon</option>
            <option value="rejete">Rejeter le brouillon</option>
          </select>
        </label>
      )}
      {kind === "insight_review" && (
        <>
          <label className="flex flex-col gap-1">
            <span className={LABEL}>Décision</span>
            <select className={FIELD} value={value} onChange={(e) => setValue(e.target.value)}>
              {REVIEW_ACTIONS.map((a) => (
                <option key={a} value={a}>
                  {REVIEW_LABEL[a]}
                </option>
              ))}
            </select>
          </label>
          {value === "reformuler" && (
            <>
              <label className="flex flex-col gap-1">
                <span className={LABEL}>Titre (verrouillé ensuite)</span>
                <input
                  className={FIELD}
                  value={title}
                  maxLength={TITLE_MAX}
                  onChange={(e) => setTitle(e.target.value)}
                  required
                  autoFocus
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className={LABEL}>Énoncé du problème</span>
                <Textarea
                  value={statement}
                  maxLength={STATEMENT_MAX}
                  rows={3}
                  onChange={(e) => setStatement(e.target.value)}
                  required
                />
              </label>
            </>
          )}
          {value === "fusionner" && (
            <label className="flex flex-col gap-1">
              <span className={LABEL}>Fusionner dans (I-xx)</span>
              <input
                className={FIELD}
                value={into}
                onChange={(e) => setInto(e.target.value)}
                pattern="[Ii]-\d{2,}"
                required
              />
            </label>
          )}
        </>
      )}
      <label className="flex flex-col gap-1">
        <span className={LABEL}>
          Raison{kind === "override" ? " (obligatoire)" : " (facultative)"}
        </span>
        <Textarea
          value={reason}
          maxLength={500}
          rows={2}
          onChange={(e) => setReason(e.target.value)}
          required={kind === "override"}
        />
      </label>
      <div className="flex gap-1.5">
        <Button size="sm" type="submit" disabled={disabled}>
          <Check aria-hidden /> Valider
        </Button>
        <Button size="sm" type="button" variant="ghost" onClick={onCancel}>
          Annuler
        </Button>
      </div>
    </form>
  );
}
