import type { Metadata } from "next";
import { AppShell } from "@/components/app-shell";
import { Recorder } from "@/components/recorder/recorder";

export const metadata: Metadata = { title: "Gravar" };

export default function RecordPage() {
  return (
    <AppShell title="Nova gravação" back="/">
      <Recorder />
    </AppShell>
  );
}
