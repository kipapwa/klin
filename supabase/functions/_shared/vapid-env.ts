import type { VapidKeys } from "./webpush.ts";

/** Lê as chaves VAPID dos segredos da função (null se faltar alguma). */
export function vapidFromEnv(get: (name: string) => string | undefined): VapidKeys | null {
  const publicKey = get("VAPID_PUBLIC_KEY");
  const privateKey = get("VAPID_PRIVATE_KEY");
  const subject = get("VAPID_SUBJECT");
  if (!publicKey || !privateKey || !subject) return null;
  return { publicKey, privateKey, subject };
}
