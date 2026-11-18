import type { Metadata } from "next";
import { Suspense } from "react";
import { AppShell } from "@/components/app-shell";
import { MedicationFormPage } from "@/components/medications/medication-form";
import { Spinner } from "@/components/ui/spinner";

export const metadata: Metadata = { title: "Remédio" };

export default function MedicationEditPage() {
  return (
    <AppShell title="Remédio" back="/medicamentos/">
      <Suspense fallback={<Spinner label="Carregando…" />}>
        <MedicationFormPage />
      </Suspense>
    </AppShell>
  );
}
