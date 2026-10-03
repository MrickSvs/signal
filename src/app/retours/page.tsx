import { Inbox } from "lucide-react";
import { EmptyState } from "@/components/shell/states";

export default function Page() {
  return (
    <EmptyState icon={Inbox} title="Retours">
      <p>Tous les retours clients, filtrables, et l&apos;ajout d&apos;un retour en direct arrivent ici.</p>
    </EmptyState>
  );
}
