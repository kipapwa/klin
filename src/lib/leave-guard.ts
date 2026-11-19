"use client";

import { useEffect } from "react";

/**
 * "Tem certeza que quer sair?" sem a caixa do sistema (beforeunload).
 * A tela registra um aviso enquanto há algo a perder (ex.: gravação não
 * enviada); os links de navegação do app (menu, voltar, sininho) perguntam
 * na caixa de confirmação do próprio app antes de sair.
 */
let message: string | null = null;

export function useLeaveGuard(msg: string | null) {
  useEffect(() => {
    message = msg;
    return () => {
      if (message === msg) message = null;
    };
  }, [msg]);
}

export function leaveGuardMessage(): string | null {
  return message;
}

export function clearLeaveGuard() {
  message = null;
}
