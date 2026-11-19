import type { Metadata } from "next";
import { AppShell } from "@/components/app-shell";
import { NewRecord } from "@/components/recorder/new-record";

export const metadata: Metadata = { title: "Novo registro" };

export default function NewRecordPage() {
  return (
    <AppShell title="Novo registro" back="/">
      <NewRecord />
    </AppShell>
  );
}
