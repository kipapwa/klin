export function Spinner({ label }: { label?: string }) {
  return (
    <div role="status" className="flex items-center gap-3 text-sm text-zinc-500">
      <span
        aria-hidden
        className="h-5 w-5 animate-spin rounded-full border-2 border-teal-600 border-t-transparent motion-reduce:animate-none"
      />
      {label ? <span>{label}</span> : <span className="sr-only">Carregando</span>}
    </div>
  );
}
