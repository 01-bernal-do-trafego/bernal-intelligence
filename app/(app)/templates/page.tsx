import type { Metadata } from "next";
import { ComingSoon } from "@/components/shared/coming-soon";

export const metadata: Metadata = { title: "Templates" };

export default function TemplatesPage() {
  return (
    <ComingSoon
      title="Templates"
      description="Modelos reutilizáveis de dashboard para acelerar o onboarding de novos clientes. Disponível em uma próxima entrega."
    />
  );
}
