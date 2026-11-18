import type { Metadata } from "next";
import { Suspense } from "react";
import { AppShell } from "@/components/app-shell";
import { Fab } from "@/components/bottom-nav";
import { MedicationList } from "@/components/medications/medication-list";
import { PlusIcon } from "@/components/ui/icons";
import { Spinner } from "@/components/ui/spinner";

export const metadata: Metadata = { title: "Remédios" };

export default function MedicationsPage() {
  return (
    <AppShell title="Remédios">
      <Suspense fallback={<Spinner label="Carregando…" />}>
        <MedicationList />
      </Suspense>
      <Fab href="/medicamentos/editar/" label="Adicionar remédio">
        <PlusIcon size={30} />
      </Fab>
    </AppShell>
  );
}
