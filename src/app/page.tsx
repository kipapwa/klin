export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-4 px-4 py-12">
      <h1 className="text-3xl font-semibold tracking-tight text-teal-700 dark:text-teal-400">
        Klin
      </h1>
      <p className="text-base text-zinc-600 dark:text-zinc-400">
        Registros médicos por voz, medicamentos em uso e linha do tempo clínica.
      </p>
      <p className="text-sm text-zinc-500">Fase 1: estrutura inicial.</p>
    </main>
  );
}
