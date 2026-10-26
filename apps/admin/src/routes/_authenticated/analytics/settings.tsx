import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";

import { AdminShell } from "@/components/admin-shell";
import { AnalyticsSettingsPageSkeleton } from "@/components/page-skeletons";
import { TableSkeletonRows } from "@/components/skeletons";
import { Button } from "@/components/ui/button";
import { InfoNote } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { analyticsScopeQuery, invalidateAnalytics, saveStudioSettings } from "@/lib/analytics/data";
import { ANALYTICS_TITLES } from "@/lib/analytics/labels";
import { cityOf, groupByCity } from "@/lib/analytics/logic";
import type { AnStudio } from "@/lib/analytics/types";

export const Route = createFileRoute("/_authenticated/analytics/settings")({
  head: () => ({ meta: [{ title: "Настройки аналитики — Base40 Admin" }] }),
  pendingComponent: AnalyticsSettingsPageSkeleton,
  component: SettingsPage,
});

const TIPS = {
  pointZero:
    "Месячная выручка, при которой клуб выходит в ноль. В «Выручке» и «Моём городе» прогноз сравнивается с ней; у города — сумма точек 0 его открытых клубов.",
  closedOn:
    "С этого дня клуб считается закрытым: в отчётах — внизу города, фильтр «Статус». История его продаж остаётся в отчётах.",
  city: "Город и бренд клуба меняются в «Управлении» → «Клубы».",
};

type Draft = { pointZero: string; closedOn: string };

const draftOf = (s: AnStudio): Draft => ({
  pointZero: s.pointZero === null ? "" : String(s.pointZero),
  closedOn: s.closedOn ?? "",
});

function SettingsPage() {
  const qc = useQueryClient();
  const { data: scope, isLoading, isError } = useQuery(analyticsScopeQuery);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [saving, setSaving] = useState(false);

  const studios = scope ? groupByCity(scope.studios, scope.today).flatMap((g) => g.studios) : [];
  const changed = studios.filter((s) => {
    const d = drafts[s.id];
    if (!d) return false;
    const base = draftOf(s);
    return d.pointZero !== base.pointZero || d.closedOn !== base.closedOn;
  });

  const save = async () => {
    for (const s of changed) {
      const v = drafts[s.id].pointZero.trim().replace(",", ".");
      if (v !== "" && (!Number.isFinite(Number(v)) || Number(v) < 0)) {
        toast.error(`Точка 0 клуба «${s.name}» — неотрицательное число`);
        return;
      }
    }
    setSaving(true);
    try {
      for (const s of changed) {
        const d = drafts[s.id];
        const v = d.pointZero.trim().replace(",", ".");
        await saveStudioSettings(s.id, v === "" ? null : Number(v), d.closedOn || null);
      }
      setDrafts({});
      await invalidateAnalytics(qc);
      toast.success("Настройки сохранены");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось сохранить");
    } finally {
      setSaving(false);
    }
  };

  const set = (s: AnStudio, patch: Partial<Draft>) =>
    setDrafts((prev) => ({ ...prev, [s.id]: { ...(prev[s.id] ?? draftOf(s)), ...patch } }));

  return (
    <AdminShell
      title={ANALYTICS_TITLES.settings}
      actions={
        changed.length > 0 ? (
          <Button onClick={() => void save()} disabled={saving}>
            {saving ? <Loader2 className="animate-spin" /> : <Save />}
            Сохранить ({changed.length})
          </Button>
        ) : undefined
      }
    >
      {isError ? (
        <InfoNote variant="warning">Не удалось загрузить клубы. Обновите страницу.</InfoNote>
      ) : (
        <div className="rounded-lg border bg-background">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Клуб</TableHead>
                <TableHead tip={TIPS.city}>Город</TableHead>
                <TableHead tip={TIPS.city}>Бренд</TableHead>
                <TableHead tip={TIPS.pointZero}>Точка 0</TableHead>
                <TableHead tip={TIPS.closedOn}>Закрыт с</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading || !scope ? (
                <TableSkeletonRows columns={5} rows={6} />
              ) : (
                studios.map((s) => {
                  const d = drafts[s.id] ?? draftOf(s);
                  return (
                    <TableRow key={s.id}>
                      <TableCell className="font-medium">{s.name}</TableCell>
                      <TableCell>{cityOf(s)}</TableCell>
                      <TableCell className="text-muted-foreground">{s.brandName ?? "—"}</TableCell>
                      <TableCell>
                        <Input
                          inputMode="decimal"
                          aria-label={`Точка 0 — ${s.name}`}
                          placeholder="Не задана"
                          className="w-40"
                          disabled={!s.canManage}
                          value={d.pointZero}
                          onChange={(e) => set(s, { pointZero: e.target.value })}
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="date"
                          aria-label={`Закрыт с — ${s.name}`}
                          className="w-44"
                          disabled={!s.canManage}
                          value={d.closedOn}
                          onChange={(e) => set(s, { closedOn: e.target.value })}
                        />
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      )}
    </AdminShell>
  );
}
