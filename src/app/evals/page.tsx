import { FlaskConical } from "lucide-react";
import { EmptyState } from "@/components/shell/states";

export default function Page() {
  return (
    <EmptyState icon={FlaskConical} title="Évals">
      <p>Les scores de qualité de Signal, leur tendance et leur coût.</p>
    </EmptyState>
  );
}
