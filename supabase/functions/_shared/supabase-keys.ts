/**
 * Chaves do Supabase dentro das Edge Functions.
 *
 * Sistema novo (sb_publishable_/sb_secret_): SUPABASE_PUBLISHABLE_KEYS e
 * SUPABASE_SECRET_KEYS chegam como JSON { "<nome da chave>": "<valor>" }.
 * Sistema legado: SUPABASE_ANON_KEY e SUPABASE_SERVICE_ROLE_KEY.
 * Preferimos as novas (as legadas podem estar desativadas no projeto).
 *
 * Módulo puro: recebe a função de leitura do ambiente (testável no Node).
 */
type Getter = (name: string) => string | undefined;

function fromJson(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  try {
    const dict = JSON.parse(raw) as Record<string, unknown>;
    const value = dict.default ?? Object.values(dict).find((v) => typeof v === "string" && v);
    return typeof value === "string" && value ? value : undefined;
  } catch {
    return undefined;
  }
}

/** Chave pública (respeita o RLS): usada com o token do usuário. */
export function publishableKey(get: Getter): string | undefined {
  return fromJson(get("SUPABASE_PUBLISHABLE_KEYS")) ?? get("SUPABASE_ANON_KEY");
}

/** Chave secreta (ignora o RLS): só para tarefas sem usuário, como o disparo agendado. */
export function secretKey(get: Getter): string | undefined {
  return fromJson(get("SUPABASE_SECRET_KEYS")) ?? get("SUPABASE_SERVICE_ROLE_KEY");
}
