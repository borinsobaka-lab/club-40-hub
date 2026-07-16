import { createFileRoute } from "@tanstack/react-router";
import { UsersGroupRounded } from "@solar-icons/react";

import { PageShell } from "@/components/page-shell";
import { Card } from "@/components/ui/card";

export const Route = createFileRoute("/club")({
  head: () => ({
    meta: [
      { title: "Клуб — CLUB 40" },
      { name: "description", content: "Челленджи, участники и жизнь клуба CLUB 40." },
    ],
  }),
  component: ClubPage,
});

function ClubPage() {
  return (
    <PageShell
      header={
        <div className="pt-4 pb-8 px-4">
          <h1 className="text-3xl font-black uppercase">Клуб</h1>
          <p className="text-sm text-white/70">Челленджи, участники и события</p>
        </div>
      }
    >
      <div className="p-4">
        <Card className="flex flex-col items-center justify-center gap-3 p-10 text-center">
          <UsersGroupRounded className="h-10 w-10 text-muted-foreground" weight="BoldDuotone" />
          <div className="text-base font-semibold">Здесь скоро появится сообщество</div>
          <p className="text-sm text-muted-foreground">
            Челленджи, рейтинги и другие участники появятся в одном из ближайших обновлений.
          </p>
        </Card>
      </div>
    </PageShell>
  );
}
