import type { Metadata } from "next";
import { Suspense } from "react";
import { AppShell } from "@/components/app-shell";
import { MedicationDetail } from "@/components/medications/medication-detail";
import { Spinner } from "@/components/ui/spinner";

export const metadata: Metadata = { title: "Medicamento" };

export default function MedicationDetailPage() {
  return (
    <AppShell title="Medicamento" back="/medicamentos/">
      <Suspense fallback={<Spinner label="Carregando…" />}>
        <MedicationDetail />
      </Suspense>
    </AppShell>
  );
}
