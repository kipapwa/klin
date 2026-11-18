import type { Metadata } from "next";
import { AppShell } from "@/components/app-shell";
import { SettingsView } from "@/components/settings/settings-view";

export const metadata: Metadata = { title: "Ajustes" };

export default function SettingsPage() {
  return (
    <AppShell>
      <h1 className="mb-4 text-xl font-semibold">Ajustes</h1>
      <SettingsView />
    </AppShell>
  );
}
