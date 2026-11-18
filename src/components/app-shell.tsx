"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { RequireAuth } from "@/components/auth/require-auth";
import { BottomNav } from "@/components/bottom-nav";
import { LockGate } from "@/components/lock/lock-gate";
import { OfflineSync } from "@/components/offline/offline-sync";
import { ChevronLeftIcon, LogoMark } from "@/components/ui/icons";

/**
 * Moldura das telas logadas: sessão, bloqueio, sincronização, cabeçalho e
 * menu inferior. "Sair da conta" fica em Ajustes.
 */
export function AppShell({ title, back, action, children }: { title?: string; back?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <RequireAuth>
      <LockGate>
        <OfflineSync />
        <header className="sticky top-0 z-10 border-b border-zinc-200/70 bg-zinc-50/90 pt-[env(safe-area-inset-top)] backdrop-blur-md dark:border-zinc-800 dark:bg-zinc-950/90">
          <div className="mx-auto flex h-14 max-w-2xl items-center gap-2 px-4">
            {back ? (
              <Link
                href={back}
                className="-ml-2 flex h-10 w-10 items-center justify-center rounded-full text-zinc-700 hover:bg-zinc-200/70 dark:text-zinc-200 dark:hover:bg-zinc-800"
                aria-label="Voltar"
              >
                <ChevronLeftIcon />
              </Link>
            ) : (
              <LogoMark />
            )}
            <span className="truncate text-lg font-semibold">{title ?? "Klin"}</span>
            {action ? <div className="ml-auto">{action}</div> : null}
          </div>
        </header>
        <main className="mx-auto w-full max-w-2xl flex-1 px-4 pb-[calc(11rem+env(safe-area-inset-bottom))] pt-4">{children}</main>
        <BottomNav />
      </LockGate>
    </RequireAuth>
  );
}
