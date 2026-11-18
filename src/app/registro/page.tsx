import type { Metadata } from "next";
import { Suspense } from "react";
import { AppShell } from "@/components/app-shell";
import { RecordView } from "@/components/records/record-view";
import { Spinner } from "@/components/ui/spinner";

export const metadata: Metadata = { title: "Registro" };

// O id vem por ?id= (o GitHub Pages não tem rotas dinâmicas geradas no servidor).
export default function RecordPage() {
  return (
    <AppShell title="Registro" back="/">
      <Suspense fallback={<Spinner label="Carregando…" />}>
        <RecordView />
      </Suspense>
    </AppShell>
  );
}
