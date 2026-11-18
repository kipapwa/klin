"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { RequireAuth } from "@/components/auth/require-auth";
import { BottomNav } from "@/components/bottom-nav";
import { forgetThisDevice } from "@/lib/push";
import { getSupabase } from "@/lib/supabase";

/** Moldura das telas logadas: cabeçalho + conteúdo. */
export function AppShell({ title, back, children }: { title?: string; back?: string; children: ReactNode }) {
  const router = useRouter();

  async function signOut() {
    // Este aparelho deixa de receber os lembretes desta conta.
    await forgetThisDevice();
    await getSupabase().auth.signOut();
    router.replace("/entrar/");
  }

  return (
    <RequireAuth>
      <header className="sticky top-0 z-10 border-b border-zinc-200 bg-white/90 pt-[env(safe-area-inset-top)] backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/90">
        <div className="mx-auto flex h-14 max-w-2xl items-center gap-3 px-4">
          {back ? (
            <Link href={back} className="-ml-2 rounded-lg px-2 py-1 text-teal-700 dark:text-teal-400" aria-label="Voltar">
              ←
            </Link>
          ) : null}
          <Link href="/" className="font-semibold text-teal-700 dark:text-teal-400">
            {title ?? "Klin"}
          </Link>
          <button
            type="button"
            onClick={signOut}
            className="ml-auto rounded-lg px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-900"
          >
            Sair
          </button>
        </div>
      </header>
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 pb-[calc(10rem+env(safe-area-inset-bottom))] pt-4">
        {children}
      </main>
      <BottomNav />
    </RequireAuth>
  );
}
