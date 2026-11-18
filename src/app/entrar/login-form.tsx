"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { useSession } from "@/components/auth/session-provider";
import { getSupabase } from "@/lib/supabase";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CODE_RE = /^\d{6,10}$/;

const input =
  "w-full rounded-xl border border-zinc-300 bg-white px-4 py-3 text-base outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-600/20 dark:border-zinc-700 dark:bg-zinc-900";
const button =
  "w-full rounded-xl bg-teal-700 px-4 py-3 font-medium text-white hover:bg-teal-800 disabled:opacity-60";

/**
 * Login por código de 6 dígitos enviado por e-mail (sem senha).
 * Código em vez de link: no iPhone o link abriria o Safari, não o app instalado.
 */
export function LoginForm() {
  const router = useRouter();
  const { ready, session } = useSession();
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (ready && session) router.replace("/");
  }, [ready, session, router]);

  async function sendCode(e: FormEvent) {
    e.preventDefault();
    const value = email.trim().toLowerCase();
    if (!EMAIL_RE.test(value) || value.length > 254) {
      setError("Digite um e-mail válido.");
      return;
    }
    setBusy(true);
    setError(null);
    const { error } = await getSupabase().auth.signInWithOtp({
      email: value,
      options: { shouldCreateUser: true },
    });
    setBusy(false);
    if (error) {
      setError(
        error.status === 429
          ? "Muitas tentativas. Aguarde um minuto e tente de novo."
          : "Não foi possível enviar o código. Tente de novo.",
      );
      return;
    }
    setEmail(value);
    setStep("code");
  }

  async function verifyCode(e: FormEvent) {
    e.preventDefault();
    const token = code.replace(/\D/g, "");
    if (!CODE_RE.test(token)) {
      setError("Digite o código recebido por e-mail.");
      return;
    }
    setBusy(true);
    setError(null);
    const { error } = await getSupabase().auth.verifyOtp({ email, token, type: "email" });
    setBusy(false);
    if (error) {
      setError("Código inválido ou expirado.");
      return;
    }
    router.replace("/");
  }

  if (step === "email") {
    return (
      <form onSubmit={sendCode} className="flex flex-col gap-3" noValidate>
        <label htmlFor="email" className="text-sm font-medium">
          E-mail
        </label>
        <input
          id="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          required
          maxLength={254}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={input}
          placeholder="voce@exemplo.com"
        />
        {error ? <p role="alert" className="text-sm text-red-700 dark:text-red-400">{error}</p> : null}
        <button type="submit" disabled={busy} className={button}>
          {busy ? "Enviando…" : "Receber código"}
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={verifyCode} className="flex flex-col gap-3" noValidate>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Enviamos um código para <strong className="text-zinc-900 dark:text-zinc-100">{email}</strong>.
      </p>
      <label htmlFor="code" className="text-sm font-medium">
        Código
      </label>
      <input
        id="code"
        inputMode="numeric"
        autoComplete="one-time-code"
        required
        maxLength={10}
        value={code}
        onChange={(e) => setCode(e.target.value)}
        className={`${input} tracking-[0.4em]`}
        placeholder="000000"
      />
      {error ? <p role="alert" className="text-sm text-red-700 dark:text-red-400">{error}</p> : null}
      <button type="submit" disabled={busy} className={button}>
        {busy ? "Verificando…" : "Entrar"}
      </button>
      <button
        type="button"
        onClick={() => {
          setStep("email");
          setCode("");
          setError(null);
        }}
        className="text-sm text-teal-700 dark:text-teal-400"
      >
        Usar outro e-mail
      </button>
    </form>
  );
}
