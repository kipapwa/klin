"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ComponentProps } from "react";
import { clearLeaveGuard, leaveGuardMessage } from "@/lib/leave-guard";
import { useConfirm } from "./confirm";

/** Link de navegação do app que respeita o useLeaveGuard (confirmação própria do app). */
export function GuardedLink({ href, onClick, ...rest }: ComponentProps<typeof Link> & { href: string }) {
  const router = useRouter();
  const confirm = useConfirm();
  return (
    <Link
      href={href}
      {...rest}
      onClick={async (e) => {
        const message = leaveGuardMessage();
        if (message) {
          e.preventDefault();
          const ok = await confirm({ title: "Sair desta tela?", message, confirmLabel: "Sair", cancelLabel: "Ficar", tone: "danger", icon: "⚠️" });
          if (!ok) return;
          clearLeaveGuard();
          onClick?.(e);
          router.push(href);
          return;
        }
        onClick?.(e);
      }}
    />
  );
}
