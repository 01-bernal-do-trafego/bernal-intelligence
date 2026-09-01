import type { Metadata } from "next";
import { ComingSoon } from "@/components/shared/coming-soon";

export const metadata: Metadata = { title: "Intelligence" };

export default function IntelligencePage() {
  return (
    <ComingSoon
      title="Intelligence"
      description="Recomendações, alertas de performance e otimizações assistidas por IA entram em uma fase futura. A fundação atual já foi desenhada para receber esse módulo."
    />
  );
}
