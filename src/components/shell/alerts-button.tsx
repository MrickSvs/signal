"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell } from "lucide-react";
import { AlertCard } from "@/components/alerts/alert-card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { OpenAlert } from "@/server/queries/shell";

/** While an investigation runs, the header is re-read so its dossier appears (~30 s). */
const REFRESH_MS = 5_000;

/** Badge of open alerts (SPEC §10.10) that opens their list and their dossiers. */
export function AlertsButton({ alerts, now }: { alerts: OpenAlert[]; now: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const count = alerts.length;
  const investigating = alerts.some((a) => a.dossier_status === "en_cours");

  useEffect(() => {
    if (!investigating) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [investigating, router]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label={`${count} alerte${count > 1 ? "s" : ""} ouverte${count > 1 ? "s" : ""}`}
        className={cn(buttonVariants({ variant: "outline" }), "gap-2")}
      >
        <Bell aria-hidden className={count > 0 ? "text-amber-600" : "text-muted-foreground"} />
        Alertes
        <span
          className={cn(
            "min-w-5 rounded-full px-1.5 text-center text-[13px] leading-5 font-semibold tabular-nums",
            count > 0 ? "bg-amber-500 text-white" : "bg-muted text-muted-foreground",
          )}
        >
          {count}
        </span>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[34rem] gap-0 p-0 text-sm">
        <p className="border-b px-4 py-3 font-medium">Alertes ouvertes</p>
        {count === 0 ? (
          <p className="px-4 py-6 text-center text-muted-foreground">
            Aucune alerte ouverte. Le reste est dans le digest.
          </p>
        ) : (
          <ul className="max-h-[32rem] divide-y overflow-y-auto">
            {alerts.map((alert) => (
              <li key={alert.id} className="px-4 py-3">
                <AlertCard
                  alert={alert}
                  now={now}
                  defaultOpen={count === 1}
                  onDone={() => setOpen(false)}
                />
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
