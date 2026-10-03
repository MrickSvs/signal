import { Newspaper } from "lucide-react";
import { EmptyState } from "@/components/shell/states";

export default function DigestPage() {
  return (
    <EmptyState icon={Newspaper} title="Bonjour Léa">
      <p>Ce qui a changé depuis ta dernière visite s&apos;affichera ici.</p>
    </EmptyState>
  );
}
