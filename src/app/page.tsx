import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { RecordList } from "@/components/records/record-list";

export default function Home() {
  return (
    <AppShell>
      <h1 className="mb-4 text-xl font-semibold">Registros</h1>
      <RecordList />
      <Link
        href="/gravar/"
        className="fixed bottom-[calc(1.5rem+env(safe-area-inset-bottom))] left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full bg-teal-700 px-6 py-4 font-semibold text-white shadow-lg hover:bg-teal-800"
      >
        <span aria-hidden className="h-3 w-3 rounded-full bg-red-400" />
        Gravar
      </Link>
    </AppShell>
  );
}
