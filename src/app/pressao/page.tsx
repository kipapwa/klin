import type { Metadata } from "next";
import { AppShell } from "@/components/app-shell";
import { PressureScreen } from "@/components/pressure/pressure-screen";

export const metadata: Metadata = { title: "Pressão" };

export default function PressurePage() {
  return (
    <AppShell title="Pressão">
      <PressureScreen />
    </AppShell>
  );
}
