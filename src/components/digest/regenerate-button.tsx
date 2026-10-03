"use client";

import { useState, useTransition } from "react";
import { RefreshCw } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatCost } from "@/lib/format";
import { cn } from "@/lib/utils";
import { regenerateDigest, type RegenerateResult } from "@/server/actions/digest";

/** « Régénérer » with a confirmation (one reasoning call, a few cents, ~15 s). */
export function RegenerateButton({ label = "Régénérer" }: { label?: string }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<RegenerateResult | null>(null);

  function confirm() {
    setResult(null);
    startTransition(async () => {
      const outcome = await regenerateDigest().catch((): RegenerateResult => ({
        ok: false,
        message: "Le serveur ne répond pas.",
      }));
      setResult(outcome);
      if (outcome.ok) setOpen(false);
    });
  }

  return (
    <div className="flex items-center gap-2">
      {result && (
        <span
          role="status"
          className={cn(result.ok ? "text-muted-foreground" : "text-destructive")}
        >
          {result.ok
            ? `${result.writer === "repli" ? "Rendu brut (rédaction en échec)" : "Digest régénéré"} en ${Math.round(result.durationMs / 1000)} s · ${formatCost(result.costEur)}`
            : result.message}
        </span>
      )}
      <Popover open={open} onOpenChange={(next) => !pending && setOpen(next)}>
        <PopoverTrigger className={cn(buttonVariants({ variant: "outline" }))} disabled={pending}>
          <RefreshCw aria-hidden className={cn(pending && "animate-spin")} />
          {pending ? "Génération…" : label}
        </PopoverTrigger>
        <PopoverContent align="end" className="w-80 gap-3 p-3.5 text-sm">
          <p className="font-medium">Régénérer le digest ?</p>
          <p className="leading-relaxed text-muted-foreground">
            Signal relit les faits tels qu&apos;ils sont maintenant et rédige un nouveau digest.
            Environ 15 secondes et quelques centimes. Les retours pas encore traités attendent le
            run de cette nuit.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              Annuler
            </Button>
            <Button onClick={confirm} disabled={pending}>
              {pending ? "Génération…" : "Régénérer"}
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
