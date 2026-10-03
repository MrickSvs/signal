"use client";

import { useRouter } from "next/navigation";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";

/** Side panel of one feedback, driven by the URL (?retour=R-042): closing it drops the param. */
export function DetailSheet({
  id,
  closeHref,
  children,
}: {
  id: string;
  closeHref: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) router.push(closeHref, { scroll: false });
      }}
    >
      <SheetContent className="w-[40rem] gap-0 overflow-y-auto p-0 text-[15px] data-[side=right]:sm:max-w-[40rem]">
        <SheetTitle className="sr-only">Retour {id}</SheetTitle>
        {children}
      </SheetContent>
    </Sheet>
  );
}
