import type { Metadata } from "next";
import { AppShell } from "@/components/app-shell";
import { SettingsView } from "@/components/settings/settings-view";

export const metadata: Metadata = { title: "Ajustes" };

export default function SettingsPage() {
  return (
    <AppShell>
      <SettingsView />
    </AppShell>
  );
}
