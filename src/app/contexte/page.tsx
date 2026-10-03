import { BookOpen } from "lucide-react";
import { EmptyState } from "@/components/shell/states";

export default function Page() {
  return (
    <EmptyState icon={BookOpen} title="Contexte">
      <p>Ce que Signal sait de Jalon : vision, OKRs, personas, règles et skills.</p>
    </EmptyState>
  );
}
