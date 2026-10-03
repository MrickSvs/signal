import { ListOrdered } from "lucide-react";
import { EmptyState } from "@/components/shell/states";

export default function Page() {
  return (
    <EmptyState icon={ListOrdered} title="Priorisation">
      <p>Le classement RICE, la bascule comptes / MRR, tes overrides et le MoSCoW.</p>
    </EmptyState>
  );
}
