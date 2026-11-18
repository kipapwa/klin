import { UserFacingError } from "./records";
import { getSupabase } from "./supabase";

export type NotificationPrivacy = "discreet" | "detailed";

export interface Profile {
  id: string;
  timezone: string;
  notification_privacy: NotificationPrivacy;
}

const COLUMNS = "id, timezone, notification_privacy";

/** Fuso do aparelho (ex.: "America/Sao_Paulo"). */
export function deviceTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Sao_Paulo";
}

/**
 * Perfil do usuário logado. Se não existir (conta criada antes do gatilho
 * de cadastro), cria com o fuso deste aparelho e privacidade discreta.
 */
export async function getProfile(): Promise<Profile> {
  const supabase = getSupabase();
  const userId = (await supabase.auth.getSession()).data.session?.user.id;
  if (!userId) throw new UserFacingError("Sessão expirada. Entre novamente.");

  const { data, error } = await supabase.from("profiles").select(COLUMNS).eq("id", userId).maybeSingle();
  if (error) throw new UserFacingError(`Não foi possível carregar seus ajustes (código ${error.code || "rede"}).`);
  if (data) return data as Profile;

  const created = await supabase
    .from("profiles")
    .upsert({ id: userId, timezone: deviceTimeZone() }, { onConflict: "id", ignoreDuplicates: true })
    .select(COLUMNS)
    .maybeSingle();
  if (created.data) return created.data as Profile;
  // ignoreDuplicates não devolve a linha se outra aba criou ao mesmo tempo: lê de novo.
  const again = await supabase.from("profiles").select(COLUMNS).eq("id", userId).maybeSingle();
  if (again.data) return again.data as Profile;
  throw new UserFacingError(`Não foi possível criar seus ajustes (código ${created.error?.code || again.error?.code || "?"}).`);
}

export async function updateProfile(id: string, patch: Partial<Pick<Profile, "timezone" | "notification_privacy">>): Promise<void> {
  const { error } = await getSupabase().from("profiles").update(patch).eq("id", id);
  if (error) throw new UserFacingError("Não foi possível salvar.");
}
