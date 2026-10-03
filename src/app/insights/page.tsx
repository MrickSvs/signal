import { Layers } from "lucide-react";
import { EmptyState } from "@/components/shell/states";

export default function Page() {
  return (
    <EmptyState icon={Layers} title="Insights">
      <p>Les problèmes derrière les demandes, et les sujets que Signal te propose de valider.</p>
    </EmptyState>
  );
}
