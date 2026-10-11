import { createFileRoute } from "@tanstack/react-router";
import { UsersGroupRounded } from "@solar-icons/react";

import { PageShell } from "@/components/page-shell";
import { Card } from "@/components/ui/card";
import { IS_PACKAGES } from "@/lib/terms";
import { PackagesStudioPage } from "@/formats/packages/studio-page";

export const Route = createFileRoute("/club")({
  head: () => ({
    meta: [
      { title: IS_PACKAGES ? "Студия — Base40" : "Клуб — Base40" },
      {
        name: "description",
        content: IS_PACKAGES
          ? "О студии и её тренерах."
          : "Челленджи, участники и жизнь клуба Base40.",
      },
    ],
  }),
  // Пакетное приложение — раздел «Студия» (src/formats/packages/).
  component: IS_PACKAGES ? PackagesStudioPage : ClubPage,
});

function ClubPage() {
  return (
    <PageShell
      header={
        <div className="pt-4 pb-8 px-4">
          <h1 className="text-3xl font-semibold">Клуб</h1>
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
