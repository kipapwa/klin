"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { PillIcon, SettingsIcon, TimelineIcon } from "@/components/ui/icons";

const TABS = [
  {
    href: "/",
    label: "Registros",
    Icon: TimelineIcon,
    match: (p: string) => p === "/" || p.startsWith("/registro") || p.startsWith("/gravar"),
  },
  { href: "/medicamentos/", label: "Remédios", Icon: PillIcon, match: (p: string) => p.startsWith("/medicamentos") },
  { href: "/ajustes/", label: "Ajustes", Icon: SettingsIcon, match: (p: string) => p.startsWith("/ajustes") },
];

/** Menu inferior com ícones (padrão de app de celular). */
export function BottomNav() {
  // usePathname já vem sem o basePath.
  const pathname = usePathname() ?? "/";
  return (
    <nav
      aria-label="Navegação principal"
      className="fixed inset-x-0 bottom-0 z-20 border-t border-zinc-200/80 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md dark:border-zinc-800 dark:bg-zinc-950/95"
    >
      <ul className="mx-auto flex max-w-2xl px-2">
        {TABS.map(({ href, label, Icon, match }) => {
          const active = match(pathname);
          return (
            <li key={href} className="flex-1">
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className="group flex h-16 flex-col items-center justify-center gap-1 text-xs font-medium"
              >
                <span
                  className={`flex h-8 w-14 items-center justify-center rounded-full transition-colors ${active ? "bg-teal-100 text-teal-800 dark:bg-teal-900 dark:text-teal-100" : "text-zinc-500 group-hover:bg-zinc-100 dark:group-hover:bg-zinc-900"}`}
                >
                  <Icon size={22} />
                </span>
                <span className={active ? "text-teal-800 dark:text-teal-200" : "text-zinc-500"}>{label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Botão redondo flutuante, à direita, acima do menu. */
export function Fab({ href, label, children }: { href: string; label: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      aria-label={label}
      title={label}
      className="fixed bottom-[calc(5.5rem+env(safe-area-inset-bottom))] right-[max(1.25rem,calc((100vw-42rem)/2+1.25rem))] z-30 flex h-16 w-16 items-center justify-center rounded-full bg-teal-700 text-white shadow-lg shadow-teal-900/30 transition hover:bg-teal-800 active:scale-95"
    >
      {children}
    </Link>
  );
}
