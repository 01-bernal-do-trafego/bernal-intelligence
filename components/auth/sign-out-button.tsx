"use client";

import { useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { signOut } from "@/app/(app)/actions";

interface SignOutButtonProps {
  children: ReactNode;
  className?: string;
  pendingLabel?: ReactNode;
}

/**
 * Logout real. Chama a server action que encerra a sessão do Supabase e
 * remove os cookies, depois navega para /login e limpa o cache do router,
 * de modo que o proxy reavalie a ausência de sessão em qualquer rota.
 *
 * Não usa <form>: dentro de um menu que fecha ao clicar, o <form> seria
 * desmontado antes do submit e a ação nunca rodaria.
 */
export function SignOutButton({
  children,
  className,
  pendingLabel = "Saindo…",
}: SignOutButtonProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function handleClick() {
    startTransition(async () => {
      try {
        await signOut();
      } finally {
        router.replace("/login");
        router.refresh();
      }
    });
  }

  return (
    <button
      type="button"
      disabled={pending}
      onClick={handleClick}
      className={className}
    >
      {pending ? pendingLabel : children}
    </button>
  );
}
