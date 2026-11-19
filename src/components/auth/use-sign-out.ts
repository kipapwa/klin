"use client";

import { useRouter } from "next/navigation";
import { useCallback } from "react";
import { useConfirm } from "@/components/ui/confirm";
import { clearLock } from "@/lib/app-lock";
import { deleteDraftsOf, pendingDraftCount } from "@/lib/offline-store";
import { forgetThisDevice } from "@/lib/push";
import { forgetUserScreens } from "@/lib/screen-cache";
import { getSupabase } from "@/lib/supabase";

/** Sair da conta sem deixar nada dela no aparelho (lembretes, PIN, gravações pendentes). */
export function useSignOut() {
  const router = useRouter();
  const confirm = useConfirm();
  return useCallback(async () => {
    const supabase = getSupabase();
    const userId = (await supabase.auth.getSession()).data.session?.user.id;
    const pending = userId ? await pendingDraftCount(userId) : 0;
    const ok = await confirm({
      icon: "🚪",
      title: "Sair da conta?",
      message:
        pending > 0
          ? `Há ${pending} ${pending === 1 ? "gravação ainda não enviada" : "gravações ainda não enviadas"} neste aparelho, e ${pending === 1 ? "ela será apagada" : "elas serão apagadas"}.`
          : "Para voltar, entre de novo com o código enviado ao seu e-mail.",
      confirmLabel: "Sair",
      tone: "danger",
    });
    if (!ok) return;
    await forgetThisDevice();
    clearLock();
    forgetUserScreens(userId ?? null); // telas guardadas desta conta
    if (userId) await deleteDraftsOf(userId);
    await supabase.auth.signOut();
    router.replace("/entrar/");
  }, [router, confirm]);
}
