import { ScrollText } from "lucide-react";
import { EmptyState } from "@/components/shell/states";

export default function Page() {
  return (
    <EmptyState icon={ScrollText} title="Backlog">
      <p>Epics, stories, bugs et tâches rédigés par Signal, à valider avant l&apos;envoi dans Notion.</p>
    </EmptyState>
  );
}
