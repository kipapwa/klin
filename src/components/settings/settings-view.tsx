"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useSession } from "@/components/auth/session-provider";
import { Spinner } from "@/components/ui/spinner";
import { deviceTimeZone, getProfile, updateProfile, type NotificationPrivacy, type Profile } from "@/lib/profile";
import { devicePushState, disablePush, enablePush, sendTestNotification, type DevicePushState } from "@/lib/push";
import { UserFacingError } from "@/lib/records";

const button =
  "rounded-xl border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-700 dark:hover:bg-zinc-800";
const primary = "rounded-xl bg-teal-700 px-4 py-3 font-semibold text-white hover:bg-teal-800 disabled:opacity-60";

function messageOf(err: unknown) {
  return err instanceof UserFacingError ? err.message : "Algo deu errado. Tente de novo.";
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">{title}</h2>
      {children}
    </section>
  );
}

const PRIVACY_OPTIONS: { value: NotificationPrivacy; label: string; preview: string }[] = [
  { value: "discreet", label: "Discreta (recomendado)", preview: "Hora da sua medicação programada." },
  { value: "detailed", label: "Mostrar o nome do remédio", preview: "Hora de tomar Losartana — 50 mg." },
];

export function SettingsView() {
  const { session } = useSession();
  const [push, setPush] = useState<DevicePushState | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const refreshPush = useCallback(async () => {
    try {
      return await devicePushState();
    } catch {
      return { support: "unsupported", permission: "unknown", subscribed: false } as DevicePushState;
    }
  }, []);

  useEffect(() => {
    let active = true;
    refreshPush().then((s) => active && setPush(s));
    getProfile()
      .then((p) => active && setProfile(p))
      .catch((err) => active && setNotice({ tone: "error", text: messageOf(err) }));
    return () => {
      active = false;
    };
  }, [refreshPush]);

  async function run(action: () => Promise<void>, okText?: string) {
    setBusy(true);
    setNotice(null);
    try {
      await action();
      if (okText) setNotice({ tone: "ok", text: okText });
    } catch (err) {
      setNotice({ tone: "error", text: messageOf(err) });
    }
    setPush(await refreshPush());
    setBusy(false);
  }

  const deviceTz = typeof window === "undefined" ? "" : deviceTimeZone();

  return (
    <div className="flex flex-col gap-3">
      {notice ? (
        <p
          role="status"
          className={`rounded-xl px-4 py-2 text-sm ${notice.tone === "ok" ? "bg-teal-700 text-white" : "bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-200"}`}
        >
          {notice.text}
        </p>
      ) : null}

      <Card title="Notificações neste aparelho">
        {!push ? (
          <Spinner />
        ) : push.support === "not-configured" ? (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">As notificações ainda não foram configuradas no servidor do app.</p>
        ) : push.support === "unsupported" ? (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">Este navegador não aceita notificações. Atualize-o ou use outro navegador.</p>
        ) : push.support === "ios-needs-install" ? (
          <div className="text-sm text-zinc-700 dark:text-zinc-300">
            <p>No iPhone, os lembretes só funcionam com o Klin instalado:</p>
            <ol className="mt-2 list-decimal pl-5">
              <li>
                Toque em <strong>Compartilhar</strong> (quadrado com seta) no Safari.
              </li>
              <li>
                Escolha <strong>Adicionar à Tela de Início</strong>.
              </li>
              <li>Abra o Klin pelo ícone e volte aqui.</li>
            </ol>
          </div>
        ) : push.permission === "denied" ? (
          <p className="text-sm text-zinc-700 dark:text-zinc-300">
            As notificações do Klin estão bloqueadas. Libere nas configurações do navegador (ícone de cadeado ao lado do endereço) e recarregue.
          </p>
        ) : push.subscribed ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm font-medium text-teal-800 dark:text-teal-300">✓ Ativadas neste aparelho</p>
            <p className="text-xs text-zinc-500">
              Você recebe um aviso no horário de cada dose dos remédios com lembrete ligado.
            </p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={button} disabled={busy} onClick={() => run(sendTestNotification, "Notificação de teste enviada.")}>
                Enviar teste
              </button>
              <button type="button" className={button} disabled={busy} onClick={() => run(disablePush, "Notificações desativadas neste aparelho.")}>
                Desativar neste aparelho
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-zinc-700 dark:text-zinc-300">Receba um aviso na hora de cada dose, mesmo com o app fechado.</p>
            <button type="button" className={primary} disabled={busy} onClick={() => run(enablePush, "Notificações ativadas ✓")}>
              {busy ? "Ativando…" : "Ativar notificações"}
            </button>
          </div>
        )}
      </Card>

      <Card title="O que aparece na tela bloqueada">
        {!profile ? (
          <Spinner />
        ) : (
          <fieldset className="flex flex-col gap-2" disabled={busy}>
            <legend className="sr-only">Privacidade das notificações</legend>
            {PRIVACY_OPTIONS.map((o) => (
              <label
                key={o.value}
                className={`flex cursor-pointer gap-3 rounded-xl border p-3 ${profile.notification_privacy === o.value ? "border-teal-600 bg-teal-50 dark:bg-teal-950" : "border-zinc-200 dark:border-zinc-800"}`}
              >
                <input
                  type="radio"
                  name="privacy"
                  value={o.value}
                  checked={profile.notification_privacy === o.value}
                  onChange={() =>
                    run(async () => {
                      await updateProfile(profile.id, { notification_privacy: o.value });
                      setProfile({ ...profile, notification_privacy: o.value });
                    }, "Preferência salva.")
                  }
                  className="mt-1 accent-teal-700"
                />
                <span>
                  <span className="block text-sm font-medium">{o.label}</span>
                  <span className="mt-1 block rounded-lg bg-zinc-100 px-3 py-2 text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                    <strong>Klin</strong> · {o.preview}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>
        )}
      </Card>

      <Card title="Fuso horário dos lembretes">
        {!profile ? (
          <Spinner />
        ) : (
          <div className="flex flex-col gap-2 text-sm">
            <p>
              Usando <strong>{profile.timezone}</strong>.
            </p>
            {deviceTz && deviceTz !== profile.timezone ? (
              <button
                type="button"
                className={button}
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    await updateProfile(profile.id, { timezone: deviceTz });
                    setProfile({ ...profile, timezone: deviceTz });
                  }, "Fuso atualizado.")
                }
              >
                Usar o fuso deste aparelho ({deviceTz})
              </button>
            ) : null}
          </div>
        )}
      </Card>

      <Card title="Conta">
        <p className="text-sm">{session?.user.email}</p>
      </Card>
    </div>
  );
}
