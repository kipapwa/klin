import type { Metadata } from "next";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Entrar" };

export default function LoginPage() {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 px-4 py-12">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight text-teal-700 dark:text-teal-400">Klin</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">Seus registros médicos por voz.</p>
      </div>
      <LoginForm />
    </main>
  );
}
