"use client";

import { GuardedLink as Link } from "@/components/ui/guarded-link";
import type { ReactNode } from "react";
import { RequireAuth } from "@/components/auth/require-auth";
import { BottomNav } from "@/components/bottom-nav";
import { LockGate } from "@/components/lock/lock-gate";
import { OfflineSync } from "@/components/offline/offline-sync";
import { NotificationBell } from "@/components/notifications/bell";
import { ChevronLeftIcon, LogoMark } from "@/components/ui/icons";
import { ICON_BUTTON } from "@/components/ui/sheet";

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
          <div className="mx-auto flex h-16 max-w-2xl items-center gap-3 px-4">
            {back ? (
              // Botão de voltar no estilo Cozinha Doce: quadrado arredondado com sombra.
              <Link href={back} className={ICON_BUTTON} aria-label="Voltar" title="Voltar">
                <ChevronLeftIcon size={21} strokeWidth={2.2} />
              </Link>
            ) : (
              <LogoMark size={34} />
            )}
            <span className="min-w-0 flex-1 truncate text-xl font-semibold tracking-tight">{title ?? "Klin"}</span>
            {action}
            <NotificationBell />
          </div>
        </header>
        <main className="mx-auto w-full max-w-2xl flex-1 px-4 pb-[calc(11rem+env(safe-area-inset-bottom))] pt-4">{children}</main>
        <BottomNav />
      </LockGate>
    </RequireAuth>
  );
}
