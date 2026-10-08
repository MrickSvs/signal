"use client";

import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useDigestGeneration } from "@/components/digest/generation";
import { cn } from "@/lib/utils";

/**
 * « Régénérer ce digest » with a confirmation (one reasoning call, a few cents, ~20 s): rewrites
 * the digest shown over the same period (ADR-043). What happens then shows live under the header
 * (ADR-044).
 */
export function RegenerateButton() {
  const [open, setOpen] = useState(false);
  const { status, start } = useDigestGeneration();
  const running = status === "running";

  return (
    <Popover open={open} onOpenChange={(next) => !running && setOpen(next)}>
      <PopoverTrigger className={cn(buttonVariants({ variant: "outline" }))} disabled={running}>
        <RefreshCw aria-hidden className={cn(running && "animate-spin")} />
        {running ? "Génération…" : "Régénérer ce digest"}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 gap-3 p-3.5 text-sm">
        <p className="font-medium">Régénérer ce digest ?</p>
        <p className="leading-relaxed text-muted-foreground">
          Signal réécrit ce digest sur la même période, du même début jusqu&apos;à maintenant, avec
          les faits tels qu&apos;ils sont maintenant. Le digest suivant repartira de là. Une
          vingtaine de secondes et quelques centimes. Les retours pas encore traités attendent le
          run de cette nuit.
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Annuler
          </Button>
          <Button
            onClick={() => {
              setOpen(false);
              start();
            }}
          >
            Régénérer
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
