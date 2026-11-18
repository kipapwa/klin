/** Tema do app: "" = Automático (segue o celular), "light" = Claro, "dark" = Escuro. */
export type Theme = "" | "light" | "dark";

export const THEME_KEY = "klin-tema";
export const THEME_LABEL: Record<Theme, string> = { "": "Automático", light: "Claro", dark: "Escuro" };

/**
 * Roda no <head>, antes de a tela aparecer, para não piscar o tema errado.
 * Texto fixo (sem dado do usuário), por isso pode ir como script inline.
 */
export const THEME_BOOT_SCRIPT = `try{var t=localStorage.getItem("${THEME_KEY}");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

export function themeGet(): Theme {
  try {
    const t = localStorage.getItem(THEME_KEY);
    return t === "light" || t === "dark" ? t : "";
  } catch {
    return "";
  }
}

export function themeApply(t: Theme = themeGet()) {
  if (t) document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
}

/** Automático → Claro → Escuro → Automático. */
export function themeNext(): Theme {
  const next: Theme = ({ "": "light", light: "dark", dark: "" } as const)[themeGet()];
  try {
    if (next) localStorage.setItem(THEME_KEY, next);
    else localStorage.removeItem(THEME_KEY);
  } catch {
    // sem armazenamento: vale só nesta sessão
  }
  themeApply(next);
  return next;
}
