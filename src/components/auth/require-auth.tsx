"use client";

import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { Spinner } from "@/components/ui/spinner";
import { useSession } from "./session-provider";

/**
 * Mostra o conteúdo só com sessão ativa; sem sessão, vai para /entrar/.
 * É conveniência de navegação: a proteção real dos dados é o RLS.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { ready, session } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (ready && !session) router.replace("/entrar/");
  }, [ready, session, router]);

  if (!ready || !session) {
    return (
      <div className="flex flex-1 items-center justify-center py-24">
        <Spinner label="Carregando…" />
      </div>
    );
  }
  return <>{children}</>;
}
