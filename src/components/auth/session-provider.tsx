"use client";

import type { Session } from "@supabase/supabase-js";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { setScreenUser } from "@/lib/screen-cache";
import { getSupabase } from "@/lib/supabase";

interface SessionState {
  /** false até o Supabase ler a sessão salva no aparelho. */
  ready: boolean;
  session: Session | null;
}

const SessionContext = createContext<SessionState>({ ready: false, session: null });

export const isSupabaseConfigured = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>({ ready: false, session: null });

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    // INITIAL_SESSION chega logo após a inscrição; depois, login/logout/refresh.
    const { data } = getSupabase().auth.onAuthStateChange((_event, session) => {
      // Guardado das telas instantâneas é separado por conta.
      setScreenUser(session?.user.id ?? null);
      setState({ ready: true, session });
    });
    return () => data.subscription.unsubscribe();
  }, []);

  if (!isSupabaseConfigured) {
    return (
      <main className="mx-auto max-w-md px-4 py-12 text-sm text-zinc-600">
        Supabase não configurado. Defina as variáveis do <code>.env.example</code>.
      </main>
    );
  }

  return <SessionContext.Provider value={state}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionState {
  return useContext(SessionContext);
}
