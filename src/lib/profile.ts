import { UserFacingError } from "./records";
import { getSupabase } from "./supabase";

export type NotificationPrivacy = "discreet" | "detailed";

export interface Profile {
  id: string;
  timezone: string;
  notification_privacy: NotificationPrivacy;
}

export async function getProfile(): Promise<Profile> {
  const supabase = getSupabase();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new UserFacingError("Sessão expirada. Entre novamente.");
  const { data, error } = await supabase
    .from("profiles")
    .select("id, timezone, notification_privacy")
    .eq("id", auth.user.id)
    .maybeSingle();
  if (error || !data) throw new UserFacingError("Não foi possível carregar seus ajustes.");
  return data as Profile;
}

export async function updateProfile(id: string, patch: Partial<Pick<Profile, "timezone" | "notification_privacy">>): Promise<void> {
  const { error } = await getSupabase().from("profiles").update(patch).eq("id", id);
  if (error) throw new UserFacingError("Não foi possível salvar.");
}

/** Fuso do aparelho (ex.: "America/Sao_Paulo"). */
export function deviceTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Sao_Paulo";
}
