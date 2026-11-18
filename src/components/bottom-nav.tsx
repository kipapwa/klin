"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/", label: "Registros", match: (p: string) => p === "/" || p.startsWith("/registro") || p.startsWith("/gravar") },
  { href: "/medicamentos/", label: "Medicamentos", match: (p: string) => p.startsWith("/medicamentos") },
  { href: "/ajustes/", label: "Ajustes", match: (p: string) => p.startsWith("/ajustes") },
];

export function BottomNav() {
  // usePathname já vem sem o basePath.
  const pathname = usePathname() ?? "/";
  return (
    <nav
      aria-label="Navegação principal"
      className="fixed inset-x-0 bottom-0 z-10 border-t border-zinc-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/95"
    >
      <ul className="mx-auto flex max-w-2xl">
        {TABS.map((tab) => {
          const active = tab.match(pathname);
          return (
            <li key={tab.href} className="flex-1">
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={`flex h-14 items-center justify-center text-sm font-medium ${active ? "text-teal-700 dark:text-teal-400" : "text-zinc-500"}`}
              >
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
