import Link from "next/link";
import { FlaskConical } from "lucide-react";
import { EmptyState } from "@/components/shell/states";

export default function Page() {
  return (
    <EmptyState icon={FlaskConical} title="Évals">
      <p>Les scores de qualité de Signal, leur tendance et leur coût.</p>
      {/* The annotation of the judge's calibration set writes into the repo: local only (PLAN 6.3). */}
      {process.env.NODE_ENV !== "production" && (
        <p className="mt-3">
          <Link href="/evals/annotate" className="text-signal underline-offset-4 hover:underline">
            Annoter le jeu de calibration du juge
          </Link>
        </p>
      )}
    </EmptyState>
  );
}
