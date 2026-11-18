import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { TimelineScreen } from "@/components/records/timeline-screen";

export default function Home() {
  return (
    <AppShell>
      <TimelineScreen />
      <Link
        href="/gravar/"
        className="fixed bottom-[calc(4.5rem+env(safe-area-inset-bottom))] left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 rounded-full bg-teal-700 px-6 py-4 font-semibold text-white shadow-lg hover:bg-teal-800"
      >
        <span aria-hidden className="h-3 w-3 rounded-full bg-red-400" />
        Gravar
      </Link>
    </AppShell>
  );
}
