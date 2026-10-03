import Link from "next/link";
import { SearchX } from "lucide-react";
import { EmptyState } from "@/components/shell/states";

export default function NotFound() {
  return (
    <EmptyState icon={SearchX} title="Page introuvable">
      <p>
        Cette adresse ne mène nulle part.{" "}
        <Link href="/" className="font-medium text-signal underline-offset-4 hover:underline">
          Retour au digest
        </Link>
      </p>
    </EmptyState>
  );
}
