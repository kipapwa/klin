/**
 * Peças da tela de Ajustes no estilo do menu da Cozinha Doce (skill tela-menu):
 * cartão do perfil com círculos decorativos, grupos com título em letras
 * pequenas, linhas com ícone em quadradinho e, à direita, seta, valor ou
 * interruptor.
 */
import Link from "next/link";
import type { ReactNode } from "react";

export const Chevron = () => (
  <span aria-hidden className="text-xl leading-none text-zinc-400">
    ›
  </span>
);

const ROW = "flex w-full items-center gap-3.5 px-4 py-3.5 text-left font-semibold active:bg-zinc-50 dark:active:bg-zinc-800";

function Ico({ children, tone = "teal" }: { children: ReactNode; tone?: "teal" | "red" }) {
  return (
    <span
      aria-hidden
      className={`grid h-[38px] w-[38px] shrink-0 place-items-center rounded-xl text-[19px] ${tone === "red" ? "bg-red-50 dark:bg-red-950" : "bg-teal-50 dark:bg-teal-950"}`}
    >
      {children}
    </span>
  );
}

function Body({ label, hint }: { label: string; hint?: ReactNode }) {
  return (
    <span className="min-w-0 flex-1">
      <span className="block">{label}</span>
      {hint ? <span className="block text-xs font-normal text-zinc-500 dark:text-zinc-400">{hint}</span> : null}
    </span>
  );
}

/** Linha: link (href) ou botão (onClick). `right` padrão = seta. */
export function MenuRow({
  ico,
  label,
  hint,
  href,
  onClick,
  right = <Chevron />,
  tone,
  disabled,
}: {
  ico: ReactNode;
  label: string;
  hint?: ReactNode;
  href?: string;
  onClick?: () => void;
  right?: ReactNode;
  tone?: "teal" | "red";
  disabled?: boolean;
}) {
  const content = (
    <>
      <Ico tone={tone}>{ico}</Ico>
      <Body label={label} hint={hint} />
      {right}
    </>
  );
  if (href) {
    return (
      <Link href={href} className={ROW}>
        {content}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={`${ROW} disabled:opacity-60 ${tone === "red" ? "text-red-700 dark:text-red-400" : ""}`}>
      {content}
    </button>
  );
}

/** Linha com interruptor: o clique é só no interruptor (por isso é um <div>). */
export function MenuSwitchRow({ ico, label, hint, control }: { ico: ReactNode; label: string; hint?: ReactNode; control: ReactNode }) {
  return (
    <div className={ROW}>
      <Ico>{ico}</Ico>
      <Body label={label} hint={hint} />
      {control}
    </div>
  );
}

/** Valor atual em cinza, à direita (ex.: tema "Automático"). */
export function MenuValue({ children }: { children: ReactNode }) {
  return (
    <span className="flex items-center gap-1 text-sm font-normal text-zinc-500 dark:text-zinc-400">
      {children}
      <Chevron />
    </span>
  );
}

/** Grupo com título. Linhas vazias (null/false) são ignoradas; grupo vazio some. */
export function MenuGroup({ title, children }: { title: string; children: ReactNode[] }) {
  const rows = children.filter(Boolean);
  if (rows.length === 0) return null;
  return (
    <>
      <h2 className="mx-1.5 mb-1.5 mt-6 text-[12.5px] font-extrabold uppercase tracking-[0.08em] text-zinc-500">{title}</h2>
      <nav
        aria-label={title}
        className="divide-y divide-zinc-100 overflow-hidden rounded-[22px] border border-zinc-200/80 bg-white shadow-[0_4px_14px_-6px_rgba(15,60,58,.22)] dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900"
      >
        {rows}
      </nav>
    </>
  );
}

/** Cartão do perfil: gradiente na cor do app e dois círculos decorativos. */
export function ProfileCard({ email }: { email: string }) {
  const initial = (email.trim()[0] || "?").toUpperCase();
  return (
    <section className="relative overflow-hidden rounded-[28px] bg-[linear-gradient(135deg,#3d8c74,#0f766e_55%,#0a4d48)] p-5 text-white shadow-[0_10px_30px_-12px_rgba(15,60,58,.45)]">
      <span aria-hidden className="absolute -right-12 -top-[70px] h-[180px] w-[180px] rounded-full bg-white/[.12]" />
      <span aria-hidden className="absolute -bottom-10 right-[60px] h-[90px] w-[90px] rounded-full bg-white/[.12]" />
      <div className="relative z-[1] flex items-center gap-3.5">
        <span className="grid h-[72px] w-[72px] shrink-0 place-items-center rounded-full border-[3px] border-white/70 bg-white/25 text-[28px] font-extrabold">
          {initial}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[22px] font-semibold leading-tight">Minha conta</h2>
          <p className="truncate text-sm opacity-85">{email}</p>
          <span className="mt-1.5 inline-flex rounded-full bg-white/25 px-2.5 py-0.5 text-xs font-bold">🔒 Dados só seus</span>
        </div>
      </div>
    </section>
  );
}
