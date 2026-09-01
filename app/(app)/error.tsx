"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 py-16 text-center">
      <h1 className="text-lg font-semibold text-foreground">
        Algo deu errado ao carregar esta página
      </h1>
      <p className="text-sm text-muted">
        Tente novamente. Se o problema persistir, verifique os dados ou recarregue
        o painel.
      </p>
      <Button variant="secondary" onClick={reset}>
        Tentar novamente
      </Button>
    </div>
  );
}
