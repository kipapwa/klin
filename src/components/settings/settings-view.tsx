"use client";

import { useCallback, useEffect, useState, useSyncExternalStore, type FormEvent } from "react";
import { useSession } from "@/components/auth/session-provider";
import { useSignOut } from "@/components/auth/use-sign-out";
import { useLock } from "@/components/lock/lock-gate";
import { Sheet } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { biometricAvailable, disableBiometric, disableLock, enableBiometric, lockNow, setPin } from "@/lib/app-lock";
import { canInstall, canInstallServer, installNow, installSteps, subscribeInstall } from "@/lib/install";
import { pinProblem } from "@/lib/pin";
import { deviceTimeZone, getProfile, updateProfile, type NotificationPrivacy, type Profile } from "@/lib/profile";
import { devicePushState, disablePush, enablePush, sendTestNotification, type DevicePushState } from "@/lib/push";
import { UserFacingError } from "@/lib/records";
import { THEME_LABEL, themeGet, themeNext, type Theme } from "@/lib/theme";
import { MenuGroup, MenuRow, MenuSwitchRow, MenuValue, ProfileCard } from "./menu-ui";

function messageOf(err: unknown) {
  return err instanceof UserFacingError ? err.message : "Algo deu errado. Tente de novo.";
}

const PRIVACY: { value: NotificationPrivacy; label: string; short: string; preview: string }[] = [
  { value: "discreet", label: "Discreta (recomendado)", short: "Discreta", preview: "Hora da sua medicação programada." },
  { value: "detailed", label: "Mostrar o nome do remédio", short: "Com o nome", preview: "Hora de tomar Losartana — 50 mg." },
];

/** "America/Sao_Paulo" -> "São Paulo". */
function tzName(tz: string) {
  const city = tz.split("/").at(-1)?.replace(/_/g, " ") ?? tz;
  return city === "Sao Paulo" ? "São Paulo" : city;
}

type ProfileState = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; profile: Profile };
type SheetKind = null | "privacy" | "timezone" | "pin" | "install";

const pinInput =
  "w-full rounded-xl border border-zinc-300 bg-white px-4 py-3 text-center text-lg tracking-[0.4em] dark:border-zinc-700 dark:bg-zinc-900";

export function SettingsView() {
  const { session } = useSession();
  const signOut = useSignOut();
  const lock = useLock();
  const installable = useSyncExternalStore(subscribeInstall, canInstall, canInstallServer);
  const [push, setPush] = useState<DevicePushState | null>(null);
  const [profileState, setProfileState] = useState<ProfileState>({ kind: "loading" });
  const [canBiometric, setCanBiometric] = useState(false);
  const [theme, setTheme] = useState<Theme>("");
  const [sheet, setSheet] = useState<SheetKind>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  // Folha do PIN
  const [pinMode, setPinMode] = useState<"create" | "disable">("create");
  const [pin, setPinValue] = useState("");
  const [confirm, setConfirm] = useState("");

  const refreshPush = useCallback(async () => {
    try {
      return await devicePushState();
    } catch {
      return { support: "unsupported", permission: "unknown", subscribed: false } as DevicePushState;
    }
  }, []);

  const loadProfile = useCallback(async (): Promise<ProfileState> => {
    try {
      return { kind: "ready", profile: await getProfile() };
    } catch (err) {
      return { kind: "error", message: messageOf(err) };
    }
  }, []);

  // Abre na hora: tudo que vem do banco ou do navegador entra depois.
  useEffect(() => {
    let active = true;
    refreshPush().then((s) => active && setPush(s));
    loadProfile().then((s) => active && setProfileState(s));
    biometricAvailable().then((ok) => active && setCanBiometric(ok));
    Promise.resolve(themeGet()).then((t) => active && setTheme(t));
    return () => {
      active = false;
    };
  }, [refreshPush, loadProfile]);

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

  function saveProfile(patch: Partial<Pick<Profile, "timezone" | "notification_privacy">>, okText: string) {
    if (profileState.kind !== "ready") return;
    const profile = profileState.profile;
    setSheet(null);
    return run(async () => {
      await updateProfile(profile.id, patch);
      setProfileState({ kind: "ready", profile: { ...profile, ...patch } });
    }, okText);
  }

  function openPin(mode: "create" | "disable") {
    setPinMode(mode);
    setPinValue("");
    setConfirm("");
    setSheet("pin");
  }

  async function submitPin(e: FormEvent) {
    e.preventDefault();
    if (pinMode === "create") {
      const problem = pinProblem(pin);
      if (problem) return setNotice({ tone: "error", text: problem });
      if (pin !== confirm) return setNotice({ tone: "error", text: "Os PINs não conferem." });
      setBusy(true);
      await setPin(pin);
      setBusy(false);
      setSheet(null);
      setNotice({ tone: "ok", text: "PIN criado. O app pede o PIN ao abrir e ao voltar depois de 1 minuto." });
    } else {
      setBusy(true);
      const ok = await disableLock(pin);
      setBusy(false);
      if (!ok) return setNotice({ tone: "error", text: "PIN incorreto." });
      setSheet(null);
      setNotice({ tone: "ok", text: "Bloqueio desativado." });
    }
  }

  const profile = profileState.kind === "ready" ? profileState.profile : null;
  const loadingValue = profileState.kind === "loading" ? "…" : null;
  const deviceTz = typeof window === "undefined" ? "" : deviceTimeZone();
  const privacy = PRIVACY.find((p) => p.value === profile?.notification_privacy) ?? PRIVACY[0];

  // Linha de notificações: interruptor quando dá; senão, o motivo.
  const pushHint = !push
    ? "Verificando…"
    : push.support === "not-configured"
      ? "Ainda não configuradas no servidor."
      : push.support === "unsupported"
        ? "Este navegador não aceita notificações."
        : push.support === "ios-needs-install"
          ? "No iPhone, instale o app primeiro."
          : push.permission === "denied"
            ? "Bloqueadas nas configurações do navegador."
            : push.subscribed
              ? "Ativadas: aviso na hora de cada dose."
              : "Aviso na hora de cada dose, mesmo com o app fechado.";
  const pushToggleable = push?.support === "ok" && push.permission !== "denied";

  return (
    <div className="flex flex-col">
      <h1 className="mb-3 text-2xl font-semibold tracking-tight">Ajustes</h1>

      {notice ? (
        <p
          role="status"
          className={`mb-3 rounded-xl px-4 py-2 text-sm ${notice.tone === "ok" ? "bg-teal-700 text-white" : "bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-200"}`}
        >
          {notice.text}
        </p>
      ) : null}

      <ProfileCard email={session?.user.email ?? ""} />

      {profileState.kind === "error" ? (
        <div role="alert" className="mt-4 flex items-center gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          <span className="flex-1">{profileState.message}</span>
          <button
            type="button"
            className="rounded-lg bg-white px-3 py-1.5 font-semibold text-red-800 shadow-sm dark:bg-zinc-900 dark:text-red-200"
            onClick={async () => {
              setProfileState({ kind: "loading" });
              setProfileState(await loadProfile());
            }}
          >
            Tentar de novo
          </button>
        </div>
      ) : null}

      <MenuGroup title="Notificações">
        {[
          <MenuSwitchRow
            key="push"
            ico="🔔"
            label="Notificações neste aparelho"
            hint={pushHint}
            control={
              pushToggleable ? (
                <Switch
                  label="Notificações neste aparelho"
                  checked={Boolean(push?.subscribed)}
                  disabled={busy}
                  onChange={(next) =>
                    run(next ? enablePush : disablePush, next ? "Notificações ativadas ✓" : "Notificações desativadas neste aparelho.")
                  }
                />
              ) : null
            }
          />,
          push?.subscribed ? (
            <MenuRow key="test" ico="📨" label="Enviar notificação de teste" disabled={busy} onClick={() => run(sendTestNotification, "Notificação de teste enviada.")} />
          ) : null,
          <MenuRow
            key="privacy"
            ico="🙈"
            label="Tela bloqueada"
            hint="O que aparece na notificação"
            disabled={!profile}
            onClick={() => setSheet("privacy")}
            right={<MenuValue>{loadingValue ?? (profile ? privacy.short : "—")}</MenuValue>}
          />,
          <MenuRow
            key="tz"
            ico="🌎"
            label="Fuso horário"
            hint="Horário dos lembretes"
            disabled={!profile}
            onClick={() => setSheet("timezone")}
            right={<MenuValue>{loadingValue ?? (profile ? tzName(profile.timezone) : "—")}</MenuValue>}
          />,
        ]}
      </MenuGroup>

      <MenuGroup title="Segurança">
        {[
          <MenuRow
            key="pin"
            ico="🔐"
            label="Bloqueio por PIN"
            hint="Pede o PIN ao abrir o app"
            onClick={() => openPin(lock.enabled ? "disable" : "create")}
            right={<MenuValue>{lock.enabled ? "Ativado" : "Desativado"}</MenuValue>}
          />,
          lock.enabled ? (
            <MenuRow key="change" ico="🔁" label="Trocar PIN" onClick={() => openPin("create")} />
          ) : null,
          lock.enabled && canBiometric ? (
            <MenuSwitchRow
              key="bio"
              ico="👆"
              label="Digital / rosto"
              hint="Desbloqueia sem digitar o PIN"
              control={
                <Switch
                  label="Desbloquear com digital ou rosto"
                  checked={lock.biometric}
                  disabled={busy}
                  onChange={async (next) => {
                    if (!next) return disableBiometric();
                    setBusy(true);
                    try {
                      await enableBiometric();
                      setNotice({ tone: "ok", text: "Biometria ativada." });
                    } catch {
                      setNotice({ tone: "error", text: "Não foi possível ativar a biometria neste aparelho." });
                    }
                    setBusy(false);
                  }}
                />
              }
            />
          ) : null,
          lock.enabled ? <MenuRow key="now" ico="🔒" label="Bloquear agora" onClick={lockNow} right={null} /> : null,
        ]}
      </MenuGroup>

      <MenuGroup title="App">
        {[
          installable ? (
            <MenuRow
              key="install"
              ico="📲"
              label="Instalar o app"
              onClick={async () => {
                if (!(await installNow())) setSheet("install");
              }}
            />
          ) : null,
          <MenuRow
            key="theme"
            ico="🎨"
            label="Tema"
            onClick={() => setTheme(themeNext())}
            right={<MenuValue>{THEME_LABEL[theme]}</MenuValue>}
          />,
          <MenuRow
            key="logout"
            ico="🚪"
            label="Sair da conta"
            tone="red"
            right={null}
            onClick={() => {
              if (window.confirm("Sair da conta neste aparelho?")) void signOut();
            }}
          />,
        ]}
      </MenuGroup>

      <p className="mt-6 text-center text-xs text-zinc-500">Klin · Registros médicos por voz</p>

      {/* ----- Folhas ----- */}
      <Sheet open={sheet === "privacy"} onClose={() => setSheet(null)} title="O que aparece na tela bloqueada">
        <div className="flex flex-col gap-2">
          {PRIVACY.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => saveProfile({ notification_privacy: o.value }, "Preferência salva.")}
              className={`rounded-xl border p-3 text-left ${profile?.notification_privacy === o.value ? "border-teal-600 bg-teal-50 dark:bg-teal-950" : "border-zinc-200 dark:border-zinc-700"}`}
            >
              <span className="block text-sm font-semibold">{o.label}</span>
              <span className="mt-1 block rounded-lg bg-zinc-100 px-3 py-2 text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                <strong>Klin</strong> · {o.preview}
              </span>
            </button>
          ))}
        </div>
      </Sheet>

      <Sheet open={sheet === "timezone"} onClose={() => setSheet(null)} title="Fuso horário dos lembretes">
        <div className="flex flex-col gap-3 text-sm">
          <p>
            Usando <strong>{profile?.timezone}</strong>.
          </p>
          {profile && deviceTz && deviceTz !== profile.timezone ? (
            <button type="button" className="rounded-xl bg-teal-700 px-4 py-3 font-semibold text-white" onClick={() => saveProfile({ timezone: deviceTz }, "Fuso atualizado.")}>
              Usar o fuso deste aparelho ({deviceTz})
            </button>
          ) : (
            <p className="text-zinc-500">É o mesmo fuso deste aparelho.</p>
          )}
        </div>
      </Sheet>

      <Sheet open={sheet === "pin"} onClose={() => setSheet(null)} title={pinMode === "create" ? (lock.enabled ? "Trocar PIN" : "Criar PIN") : "Desativar bloqueio"}>
        <form onSubmit={submitPin} className="flex flex-col gap-2" noValidate>
          <label htmlFor="new-pin" className="text-sm font-medium">
            {pinMode === "create" ? "PIN (4 a 8 números)" : "PIN atual"}
          </label>
          <input id="new-pin" type="password" inputMode="numeric" autoComplete="off" maxLength={8} className={pinInput} value={pin} onChange={(e) => setPinValue(e.target.value.replace(/\D/g, ""))} />
          {pinMode === "create" ? (
            <>
              <label htmlFor="confirm-pin" className="text-sm font-medium">
                Repita o PIN
              </label>
              <input id="confirm-pin" type="password" inputMode="numeric" autoComplete="off" maxLength={8} className={pinInput} value={confirm} onChange={(e) => setConfirm(e.target.value.replace(/\D/g, ""))} />
            </>
          ) : null}
          {notice?.tone === "error" ? (
            <p role="alert" className="text-sm text-red-700 dark:text-red-400">
              {notice.text}
            </p>
          ) : null}
          <button type="submit" disabled={busy} className="mt-2 rounded-xl bg-teal-700 px-4 py-3 font-semibold text-white disabled:opacity-60">
            {busy ? "Aguarde…" : pinMode === "create" ? "Salvar PIN" : "Desativar bloqueio"}
          </button>
          <p className="text-xs text-zinc-500">Se esquecer o PIN, saia da conta e entre de novo pelo e-mail.</p>
        </form>
      </Sheet>

      <Sheet open={sheet === "install"} onClose={() => setSheet(null)} title="Instalar o app">
        <ol className="list-decimal pl-5 text-sm">
          {installSteps().map((s) => (
            <li key={s} className="my-2">
              {s}
            </li>
          ))}
        </ol>
      </Sheet>
    </div>
  );
}
