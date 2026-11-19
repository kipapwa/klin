import { AppShell } from "@/components/app-shell";
import { Fab } from "@/components/bottom-nav";
import { TimelineScreen } from "@/components/records/timeline-screen";
import { MicIcon } from "@/components/ui/icons";

export default function Home() {
  return (
    <AppShell>
      <TimelineScreen />
      <Fab href="/gravar/" label="Novo registro">
        <MicIcon size={28} />
      </Fab>
    </AppShell>
  );
}
