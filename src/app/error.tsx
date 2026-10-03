"use client";

import { useEffect } from "react";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shell/states";

export default function ErrorPage({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <EmptyState icon={TriangleAlert} title="Cette page n'a pas pu se charger">
      <p>La base ou un service ne répond pas. Réessaie dans un instant.</p>
      {error.digest && <p className="mt-1 font-mono text-[13px]">Réf. {error.digest}</p>}
      <Button className="mt-4" variant="outline" onClick={() => retry()}>
        Réessayer
      </Button>
    </EmptyState>
  );
}
