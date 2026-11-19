"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { XIcon } from "./icons";

/**
 * Folha que sobe de baixo (<dialog> nativo: foco preso, Esc fecha, leitor de
 * tela entende). Toque fora também fecha.
 */
export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="sheet"
      aria-label={title}
      // Folha dentro de folha (ex.: horário dentro de "Editar registro"): o React
      // repassa o "close" da folha de dentro para a de fora; só a própria fecha.
      onClose={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose(); // toque no fundo escuro
      }}
    >
      <div className="flex max-h-[88dvh] flex-col rounded-t-3xl bg-white pb-[env(safe-area-inset-bottom)] text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100">
        <div className="flex items-center gap-2 px-5 pb-2 pt-3">
          <span aria-hidden className="absolute left-1/2 top-2 h-1 w-10 -translate-x-1/2 rounded-full bg-zinc-300 dark:bg-zinc-700" />
          <h2 className="mt-3 flex-1 text-lg font-semibold">{title}</h2>
          <IconButton label="Fechar" onClick={onClose} className="mt-3">
            <XIcon size={20} />
          </IconButton>
        </div>
        <div className="overflow-y-auto px-5 pb-5">{children}</div>
      </div>
    </dialog>
  );
}

/** Botão quadrado arredondado (estilo Cozinha Doce): voltar, sininho, fechar. */
export function IconButton({
  label,
  onClick,
  children,
  className = "",
}: {
  label: string;
  onClick?: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} className={`${ICON_BUTTON} ${className}`}>
      {children}
    </button>
  );
}

export const ICON_BUTTON =
  "relative grid h-[42px] w-[42px] shrink-0 place-items-center rounded-[14px] border border-zinc-200 bg-white text-zinc-800 shadow-[0_4px_14px_-6px_rgba(15,60,58,.25)] transition active:scale-95 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100";
