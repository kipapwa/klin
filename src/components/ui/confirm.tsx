"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Caixa de confirmação do próprio app — no lugar de window.confirm, que é a
 * caixa do sistema (feia, sem a cara do app e diferente em cada celular).
 *
 *   const confirm = useConfirm();
 *   if (!(await confirm({ title: "Apagar?", confirmLabel: "Apagar", tone: "danger" }))) return;
 */
export interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** "danger" = botão vermelho (apagar, sair). */
  tone?: "default" | "danger";
  icon?: string;
}

type Ask = (opts: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<Ask | null>(null);

export function useConfirm(): Ask {
  const ask = useContext(ConfirmContext);
  if (!ask) throw new Error("useConfirm fora do ConfirmProvider");
  return ask;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<(ConfirmOptions & { resolve: (ok: boolean) => void }) | null>(null);
  const ref = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  const ask = useCallback<Ask>(
    (opts) =>
      new Promise<boolean>((resolve) => {
        setCurrent((prev) => {
          prev?.resolve(false); // uma pergunta por vez: a anterior conta como "cancelar"
          return { ...opts, resolve };
        });
      }),
    [],
  );

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (current && !d.open) {
      d.showModal();
      // Em ação perigosa, o foco começa no "Cancelar" (Enter não apaga sem querer).
      if (current.tone === "danger") cancelRef.current?.focus();
    }
    if (!current && d.open) d.close();
  }, [current]);

  function answer(ok: boolean) {
    current?.resolve(ok);
    setCurrent(null);
  }

  const danger = current?.tone === "danger";

  return (
    <ConfirmContext.Provider value={ask}>
      {children}
      <dialog
        ref={ref}
        role="alertdialog"
        aria-labelledby="confirm-title"
        aria-describedby={current?.message ? "confirm-message" : undefined}
        className="confirm-dialog"
        onCancel={(e) => {
          e.preventDefault(); // Esc = cancelar
          answer(false);
        }}
        onClick={(e) => {
          if (e.target === ref.current) answer(false); // toque fora = cancelar
        }}
      >
        {current ? (
          <div className="w-[min(24rem,calc(100vw-2.5rem))] rounded-3xl bg-white p-5 text-center text-zinc-900 shadow-2xl dark:bg-zinc-900 dark:text-zinc-100">
            {current.icon ? (
              <div
                aria-hidden
                className={`mx-auto mb-3 grid h-14 w-14 place-items-center rounded-2xl text-2xl ${danger ? "bg-red-50 dark:bg-red-950" : "bg-teal-50 dark:bg-teal-950"}`}
              >
                {current.icon}
              </div>
            ) : null}
            <h2 id="confirm-title" className="text-lg font-semibold">
              {current.title}
            </h2>
            {current.message ? (
              <p id="confirm-message" className="mt-1.5 text-sm text-zinc-600 dark:text-zinc-400">
                {current.message}
              </p>
            ) : null}
            <div className="mt-5 flex gap-2">
              <button
                ref={cancelRef}
                type="button"
                onClick={() => answer(false)}
                className="flex-1 rounded-xl border border-zinc-300 bg-white px-4 py-3 font-medium dark:border-zinc-700 dark:bg-zinc-900"
              >
                {current.cancelLabel ?? "Cancelar"}
              </button>
              <button
                type="button"
                onClick={() => answer(true)}
                className={`flex-1 rounded-xl px-4 py-3 font-semibold text-white ${danger ? "bg-red-600 hover:bg-red-700" : "bg-teal-700 hover:bg-teal-800"}`}
              >
                {current.confirmLabel ?? "Confirmar"}
              </button>
            </div>
          </div>
        ) : null}
      </dialog>
    </ConfirmContext.Provider>
  );
}
