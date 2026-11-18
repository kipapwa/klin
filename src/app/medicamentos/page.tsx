import type { Metadata } from "next";
import { Suspense } from "react";
import { AppShell } from "@/components/app-shell";
import { MedicationList } from "@/components/medications/medication-list";
import { Spinner } from "@/components/ui/spinner";

export const metadata: Metadata = { title: "Medicamentos" };

export default function MedicationsPage() {
  return (
    <AppShell>
      <h1 className="mb-4 text-xl font-semibold">Medicamentos em uso</h1>
      <Suspense fallback={<Spinner label="Carregando…" />}>
        <MedicationList />
      </Suspense>
    </AppShell>
  );
}
