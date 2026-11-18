/** Prefixo do site no GitHub Pages ("" com domínio próprio, "/<repo>" sem). */
export const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

/** Monta um caminho absoluto do app respeitando o basePath. */
export function withBase(path: string): string {
  return `${basePath}${path.startsWith("/") ? path : `/${path}`}`;
}
