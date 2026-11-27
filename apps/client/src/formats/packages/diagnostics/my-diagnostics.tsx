import { useMemo, useState, type ComponentType, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AltArrowRight,
  ArrowDown,
  ArrowUp,
  CheckCircle,
  Cup,
  Dumbbell,
  GraphUp,
  HeartPulse,
  LockKeyholeMinimalistic,
  Moon,
  Ruler,
  ShieldCheck,
  Target,
  WaterSun,
  Leaf,
  Camera,
} from "@solar-icons/react";

import { BottomDrawer } from "@/components/bottom-drawer";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  SquircleAvatar,
  SquircleAvatarFallback,
  SquircleAvatarImage,
} from "@/components/ui/squircle-avatar";
import { useAuth } from "@/hooks/use-auth";
import { msg, useLocalize, useT, type Translator } from "@/i18n";
import { mediaUrl } from "@/lib/media";
import { cn } from "@/lib/utils";
import { trainerInitials } from "../entries";
import { diagnosticPhotosQuery, myDiagnosticsQuery, type BodyDiagnostic } from "./data";
import {
  METRICS,
  allChanges,
  changeFromPrevious,
  chartGroupsWithData,
  metricValue,
  signed,
  sortByDate,
  type MetricKey,
  type Trend,
} from "./metrics";
import { BEND_NOT_REACH, STAGES } from "./options";
import { LockedChartTeaser, ProgressChart } from "./progress-chart";
import { diagDate, num, recFocusOf } from "./texts";

/**
 * Результаты диагностики тела у клиента — вверху вкладки «Диагностика»
 * расписания (решение владельца 2026-11-27). Копятся все пройденные:
 *
 * - карта последней диагностики: дата, тренер, этап, главные замеры (со
 *   второй — изменение к прошлой) и «Открыть карту» — шторка со всем, что
 *   заполнил тренер (как карта клиента в прежнем продукте);
 * - одна диагностика — вместо динамики размытый график с замком: откроется
 *   после следующей;
 * - две и больше — «Ваша динамика»: график по группе показателей (объёмы,
 *   вес, шпагаты, наклон, самочувствие — только где есть ≥ 2 значения), под
 *   ним — с чего начинали и что сейчас, фото «было — стало»; и «История
 *   диагностик» — каждая открывается своей картой.
 *
 * Данных нет (не было диагностик, база без миграции) — раздела нет.
 */
export function MyDiagnostics() {
  const t = useT();
  const { user } = useAuth();
  const { data } = useQuery(myDiagnosticsQuery(user?.id ?? null));
  const list = useMemo(() => sortByDate(data ?? []), [data]);
  const [openId, setOpenId] = useState<string | null>(null);
  if (list.length === 0) return null;

  const latest = list[list.length - 1];
  const opened = list.find((d) => d.id === openId) ?? null;

  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between gap-2 px-1">
        <h2 className="text-lg font-semibold">{t("Мои диагностики")}</h2>
        <span className="text-sm text-muted-foreground">
          {t.plural(list.length, "{n} диагностика|{n} диагностики|{n} диагностик")}
        </span>
      </div>

      <LatestCard d={latest} list={list} onOpen={() => setOpenId(latest.id)} />

      {list.length === 1 ? <DynamicsLocked /> : <Dynamics list={list} />}

      {list.length > 1 && (
        <Card className="rounded-2xl p-2">
          <div className="px-3 pb-1 pt-3 text-base font-semibold">{t("История диагностик")}</div>
          {[...list].reverse().map((d, i) => (
            <button
              key={d.id}
              type="button"
              onClick={() => setOpenId(d.id)}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left active:bg-muted"
            >
              <span
                className={cn(
                  "flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold tabular-nums",
                  i === 0 ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
                )}
              >
                {list.length - i}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">{diagDate(d.diagnostic_date, t)}</span>
                <span className="block truncate text-sm text-muted-foreground">
                  {[trainerName(d), stageTitle(d.stage, t)].filter(Boolean).join(" · ")}
                </span>
              </span>
              <AltArrowRight className="h-5 w-5 shrink-0 text-muted-foreground" />
            </button>
          ))}
        </Card>
      )}

      <BottomDrawer
        open={opened !== null}
        onOpenChange={(o) => {
          if (!o) setOpenId(null);
        }}
        title={t("Диагностическая карта")}
        description={opened ? diagDate(opened.diagnostic_date, t) : undefined}
        className="h-[92vh] max-h-[92vh]"
      >
        {opened && <DiagnosticDetails d={opened} list={list} />}
      </BottomDrawer>
    </section>
  );
}

function trainerName(d: BodyDiagnostic) {
  return d.trainer?.full_name ?? d.trainer_name ?? null;
}

function stageTitle(stage: number | null, t: Translator) {
  const s = STAGES.find((x) => x.key === stage);
  return s ? t("Этап {n} — {title}", { n: s.key, title: t(s.title) }) : null;
}

/** Главные замеры для плиток карты — в этом порядке, только заполненные. */
const TILE_METRICS: MetricKey[] = [
  "waist_cm",
  "hips_cm",
  "chest_cm",
  "weight_kg",
  "split_right_cm",
  "split_left_cm",
  "split_middle_cm",
];

function unitOf(key: MetricKey, t: Translator) {
  const u = METRICS[key].unit;
  return u === "cm" ? t("см") : u === "kg" ? t("кг") : "";
}

function TrainerAvatar({ d, size = 40 }: { d: BodyDiagnostic; size?: number }) {
  const loc = useLocalize();
  const tr = d.trainer ? loc(d.trainer) : null;
  const name = tr?.full_name ?? d.trainer_name ?? "";
  const photo = mediaUrl(tr?.photo_url ?? null, "trainer-photos");
  return (
    <SquircleAvatar size={size} className="shrink-0">
      {photo && <SquircleAvatarImage src={photo} alt={name} />}
      <SquircleAvatarFallback className="bg-white/15 text-xs font-semibold text-white">
        {trainerInitials(name)}
      </SquircleAvatarFallback>
    </SquircleAvatar>
  );
}

function LatestCard({
  d,
  list,
  onOpen,
}: {
  d: BodyDiagnostic;
  list: BodyDiagnostic[];
  onOpen: () => void;
}) {
  const t = useT();
  const loc = useLocalize();
  const first = list.length === 1;
  const tiles = TILE_METRICS.filter((k) => metricValue(d, k) != null);
  const stage = STAGES.find((s) => s.key === d.stage);
  const name = (d.trainer ? loc(d.trainer).full_name : null) ?? d.trainer_name;

  return (
    <Card className="overflow-hidden rounded-2xl">
      <div className="relative overflow-hidden bg-[#2A2B2F] p-5 text-white">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-10 -top-16 h-44 w-44 rounded-full"
          style={{
            background:
              "radial-gradient(circle, color-mix(in oklab, var(--primary) 55%, transparent), transparent 70%)",
          }}
        />
        <div className="relative">
          <div className="text-sm text-white/70">{diagDate(d.diagnostic_date, t)}</div>
          <h3 className="mt-1 text-xl font-semibold leading-tight">
            {first ? t("Ваша диагностическая карта") : t("Последняя диагностика")}
          </h3>
          {name && (
            <div className="mt-4 flex items-center gap-3">
              <TrainerAvatar d={d} />
              <div className="min-w-0">
                <div className="text-xs text-white/60">{t("Ваш тренер")}</div>
                <div className="truncate font-semibold">{name}</div>
              </div>
            </div>
          )}
          {stage && (
            <div className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground">
              <CheckCircle className="h-4 w-4" weight="Bold" />
              {t("Этап {n} — {title}", { n: stage.key, title: t(stage.title) })}
            </div>
          )}
        </div>
      </div>

      <div className="space-y-4 p-4">
        {tiles.length > 0 && (
          <div className="grid grid-cols-2 gap-2">
            {tiles.map((k) => (
              <MetricTile key={k} k={k} d={d} list={list} />
            ))}
          </div>
        )}
        {(d.balance_test || d.forward_bend) && (
          <div className="grid grid-cols-2 gap-2">
            {d.balance_test && <TextTile label={t("Равновесие")} value={t(d.balance_test)} />}
            {d.forward_bend && <TextTile label={t("Наклон вперёд")} value={bendText(d, t)} />}
          </div>
        )}
        {d.measure_skipped && tiles.length === 0 && (
          <p className="text-sm text-muted-foreground">{t("Замеры в этот раз не проводились.")}</p>
        )}
        <Button className="w-full" onClick={onOpen}>
          {t("Открыть карту диагностики")}
        </Button>
      </div>
    </Card>
  );
}

function bendText(d: BodyDiagnostic, t: Translator) {
  if (d.forward_bend === BEND_NOT_REACH && d.forward_bend_cm != null)
    return t("{n} см до пола", { n: num(d.forward_bend_cm, t) });
  return d.forward_bend ? t(d.forward_bend) : "—";
}

const TREND_CLS: Record<Trend, string> = {
  better: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
  worse: "bg-muted text-muted-foreground",
  changed: "bg-primary/10 text-foreground",
  same: "bg-muted text-muted-foreground",
};

function DeltaChip({ diff, trend, unit }: { diff: number; trend: Trend; unit: string }) {
  const t = useT();
  const Icon = diff < 0 ? ArrowDown : ArrowUp;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums",
        TREND_CLS[trend],
      )}
    >
      {diff !== 0 && <Icon className="h-3 w-3" weight="Bold" />}
      {diff === 0 ? t("без изменений") : `${signed(diff, (n) => num(n, t))} ${unit}`.trim()}
    </span>
  );
}

function MetricTile({ k, d, list }: { k: MetricKey; d: BodyDiagnostic; list: BodyDiagnostic[] }) {
  const t = useT();
  const v = metricValue(d, k)!;
  const change = changeFromPrevious(list, d.id, k);
  const unit = unitOf(k, t);
  return (
    <div className="rounded-xl bg-muted p-3">
      <div className="truncate text-xs font-medium text-muted-foreground">
        {t(METRICS[k].label)}
      </div>
      <div className="mt-0.5 text-2xl font-bold tabular-nums leading-tight">
        {num(v, t)}
        <span className="ml-1 text-sm font-semibold text-muted-foreground">{unit}</span>
      </div>
      {change && (
        <div className="mt-1">
          <DeltaChip diff={change.diff} trend={change.trend} unit={unit} />
        </div>
      )}
    </div>
  );
}

function TextTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-muted p-3">
      <div className="truncate text-xs font-medium text-muted-foreground">{label}</div>
      <div className="mt-0.5 font-semibold leading-snug">{value}</div>
    </div>
  );
}

function SectionHead({
  icon: Icon,
  title,
  subtitle,
}: {
  icon: ComponentType<{ className?: string; weight?: "BoldDuotone" }>;
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/15">
        <Icon className="h-6 w-6 text-primary" weight="BoldDuotone" />
      </div>
      <div className="min-w-0">
        <h3 className="text-lg font-semibold leading-tight">{title}</h3>
        {subtitle && <div className="mt-0.5 text-sm text-muted-foreground">{subtitle}</div>}
      </div>
    </div>
  );
}

function DynamicsLocked() {
  const t = useT();
  return (
    <Card className="rounded-2xl p-5">
      <SectionHead icon={GraphUp} title={t("Ваша динамика")} />
      <div className="relative mt-4 rounded-xl bg-muted/60 p-3">
        <LockedChartTeaser />
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-[#2A2B2F] text-white shadow-md">
            <LockKeyholeMinimalistic className="h-5 w-5" weight="BoldDuotone" />
          </span>
        </div>
      </div>
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
        {t(
          "Это первый замер — сравнивать пока не с чем. Продолжайте тренировки по плану: после следующей диагностики здесь появятся графики — как меняются объёмы, гибкость и самочувствие.",
        )}
      </p>
    </Card>
  );
}

function Dynamics({ list }: { list: BodyDiagnostic[] }) {
  const t = useT();
  const groups = useMemo(() => chartGroupsWithData(list), [list]);
  const changes = useMemo(() => allChanges(list), [list]);
  const [groupKey, setGroupKey] = useState<string | null>(null);
  const group = groups.find((g) => g.key === groupKey) ?? groups[0];
  const first = list[0];
  const last = list[list.length - 1];

  return (
    <Card className="space-y-4 rounded-2xl p-5">
      <SectionHead
        icon={GraphUp}
        title={t("Ваша динамика")}
        subtitle={t("С {date} · {count}", {
          date: diagDate(first.diagnostic_date, t),
          count: t.plural(list.length, "{n} диагностика|{n} диагностики|{n} диагностик"),
        })}
      />

      {group ? (
        <>
          {groups.length > 1 && (
            <div className="no-scrollbar -mx-5 flex gap-2 overflow-x-auto px-5" role="tablist">
              {groups.map((g) => (
                <button
                  key={g.key}
                  type="button"
                  role="tab"
                  aria-selected={g.key === group.key}
                  onClick={() => setGroupKey(g.key)}
                  className={cn(
                    "shrink-0 rounded-full px-4 py-2 text-sm font-semibold transition",
                    g.key === group.key
                      ? "bg-foreground text-background"
                      : "bg-muted text-foreground",
                  )}
                >
                  {t(g.label)}
                </button>
              ))}
            </div>
          )}
          <ProgressChart key={group.key} list={list} metrics={group.metrics} />
          <div className="divide-y divide-border/60 rounded-xl bg-muted/60 px-3">
            {changes
              .filter((c) => group.metrics.includes(c.key))
              .map((c) => (
                <ChangeRow
                  key={c.key}
                  k={c.key}
                  from={c.first.value}
                  to={c.last.value}
                  diff={c.diff}
                  trend={c.trend}
                />
              ))}
          </div>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          {t(
            "Замеры повторяются от диагностики к диагностике — когда их будет хотя бы два, здесь появится график.",
          )}
        </p>
      )}

      {changes.some((c) => !group?.metrics.includes(c.key)) && (
        <div>
          <div className="mb-1 text-sm font-semibold">{t("Все изменения")}</div>
          <div className="divide-y divide-border/60">
            {changes
              .filter((c) => !group?.metrics.includes(c.key))
              .map((c) => (
                <ChangeRow
                  key={c.key}
                  k={c.key}
                  from={c.first.value}
                  to={c.last.value}
                  diff={c.diff}
                  trend={c.trend}
                />
              ))}
          </div>
        </div>
      )}

      {first.balance_test && last.balance_test && first.balance_test !== last.balance_test && (
        <TextChange
          label={t("Равновесие")}
          from={t(first.balance_test)}
          to={t(last.balance_test)}
        />
      )}

      <BeforeAfter first={first} last={last} />
    </Card>
  );
}

function ChangeRow({
  k,
  from,
  to,
  diff,
  trend,
}: {
  k: MetricKey;
  from: number;
  to: number;
  diff: number;
  trend: Trend;
}) {
  const t = useT();
  const unit = unitOf(k, t);
  const score = METRICS[k].unit === "score";
  const fmt = (v: number) =>
    score
      ? t("{n} из 10", { n: num(v, t) })
      : k === "bend_gap_cm"
        ? v === 0
          ? t("Достаёт до пола")
          : t("{n} см до пола", { n: num(v, t) })
        : `${num(v, t)} ${unit}`;
  return (
    <div className="flex items-center gap-3 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{t(METRICS[k].label)}</div>
        <div className="text-xs tabular-nums text-muted-foreground">
          {fmt(from)} → <span className="font-semibold text-foreground">{fmt(to)}</span>
        </div>
      </div>
      <DeltaChip diff={diff} trend={trend} unit={score ? "" : unit} />
    </div>
  );
}

function TextChange({ label, from, to }: { label: string; from: string; to: string }) {
  return (
    <div className="rounded-xl bg-muted/60 px-3 py-2.5">
      <div className="text-sm font-medium">{label}</div>
      <div className="text-xs text-muted-foreground">
        {from} → <span className="font-semibold text-foreground">{to}</span>
      </div>
    </div>
  );
}

/** Первое фото первой диагностики и последней — «было» и «стало». */
function BeforeAfter({ first, last }: { first: BodyDiagnostic; last: BodyDiagnostic }) {
  const t = useT();
  const a = first.photo_paths[0];
  const b = last.photo_paths[0];
  const paths = a && b ? [a, b] : [];
  const { data: urls } = useQuery(diagnosticPhotosQuery(paths));
  if (!a || !b) return null;
  return (
    <div>
      <div className="mb-2 text-sm font-semibold">{t("Было и стало")}</div>
      <div className="grid grid-cols-2 gap-2">
        {[
          { path: a, d: first },
          { path: b, d: last },
        ].map(({ path, d }) => (
          <figure key={path} className="overflow-hidden rounded-xl bg-muted">
            {urls?.[path] ? (
              <img
                src={urls[path]}
                alt=""
                loading="lazy"
                decoding="async"
                className="aspect-[3/4] w-full object-cover"
              />
            ) : (
              <div className="aspect-[3/4] w-full animate-pulse" />
            )}
            <figcaption className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
              {diagDate(d.diagnostic_date, t, false)}
            </figcaption>
          </figure>
        ))}
      </div>
    </div>
  );
}

// ---- Карта одной диагностики (шторка) ----

function DetailBlock({
  icon,
  title,
  children,
}: {
  icon: ComponentType<{ className?: string; weight?: "BoldDuotone" }>;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-2xl bg-card p-4 shadow-[0_1px_2px_rgba(0,0,0,0.04)] ring-1 ring-border/60">
      <SectionHead icon={icon} title={title} />
      <div className="mt-4">{children}</div>
    </section>
  );
}

function DiagnosticDetails({ d, list }: { d: BodyDiagnostic; list: BodyDiagnostic[] }) {
  const t = useT();
  const loc = useLocalize();
  const name = (d.trainer ? loc(d.trainer).full_name : null) ?? d.trainer_name;
  const tiles = TILE_METRICS.filter((k) => metricValue(d, k) != null);
  const index = list.findIndex((x) => x.id === d.id);
  const { data: urls } = useQuery(diagnosticPhotosQuery(d.photo_paths));
  const recFocus = recFocusOf(d, t);

  const details: { label: string; value: string }[] = [
    ...(d.activity_level != null
      ? [{ label: t("Активность"), value: t("{n} из 10", { n: d.activity_level }) }]
      : []),
    ...(d.emotional_level != null
      ? [{ label: t("Эмоциональное состояние"), value: t("{n} из 10", { n: d.emotional_level }) }]
      : []),
    ...(d.directions.length > 0
      ? [{ label: t("Первое занятие"), value: d.directions.join(", ") }]
      : []),
  ];

  return (
    <div className="space-y-3 pb-4">
      <div className="flex items-center gap-3 rounded-2xl bg-[#2A2B2F] p-4 text-white">
        <TrainerAvatar d={d} size={48} />
        <div className="min-w-0 flex-1">
          <div className="text-xs text-white/60">{t("Ваш тренер")}</div>
          <div className="truncate font-semibold">{name ?? "—"}</div>
        </div>
        <div className="shrink-0 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold tabular-nums">
          {t("Диагностика {n} из {total}", { n: index + 1, total: list.length })}
        </div>
      </div>

      {details.length > 0 && (
        <DetailBlock icon={HeartPulse} title={t("Ваши данные")}>
          <dl className="divide-y divide-border/60">
            {details.map((r) => (
              <div key={r.label} className="flex items-baseline justify-between gap-3 py-2">
                <dt className="text-sm text-muted-foreground">{r.label}</dt>
                <dd className="text-right text-sm font-semibold">{r.value}</dd>
              </div>
            ))}
          </dl>
        </DetailBlock>
      )}

      {(d.goals.length > 0 || d.priority_today) && (
        <DetailBlock icon={Target} title={t("Ваши цели")}>
          <ul className="space-y-2">
            {d.goals.map((g) => (
              <li key={g} className="flex items-start gap-2 text-[15px] leading-snug">
                <CheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-primary" weight="Bold" />
                {t(g)}
              </li>
            ))}
          </ul>
          {d.priority_today && (
            <div className="mt-4 rounded-xl bg-primary/10 p-4">
              <div className="text-xs font-semibold text-primary">{t("Главный приоритет")}</div>
              <p className="mt-1 whitespace-pre-line text-[15px] leading-relaxed">
                {d.priority_today}
              </p>
            </div>
          )}
        </DetailBlock>
      )}

      {(d.restrictions.length > 0 || d.restrictions_other || d.no_restrictions) && (
        <DetailBlock icon={ShieldCheck} title={t("Что важно учитывать")}>
          {d.no_restrictions ? (
            <p className="text-[15px]">{t("Ограничений нет")}</p>
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                {d.restrictions.map((r) => (
                  <span key={r} className="rounded-full bg-muted px-3 py-1.5 text-sm">
                    {t(r)}
                  </span>
                ))}
              </div>
              {d.restrictions_other && (
                <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
                  {d.restrictions_other}
                </p>
              )}
            </>
          )}
        </DetailBlock>
      )}

      {(tiles.length > 0 || d.balance_test || d.forward_bend) && (
        <DetailBlock icon={Ruler} title={index === 0 ? t("Точка старта") : t("Замеры")}>
          {tiles.length > 0 && (
            <div className="grid grid-cols-2 gap-2">
              {tiles.map((k) => (
                <MetricTile key={k} k={k} d={d} list={list} />
              ))}
            </div>
          )}
          {(d.balance_test || d.forward_bend) && (
            <div className={cn("grid grid-cols-2 gap-2", tiles.length > 0 && "mt-2")}>
              {d.balance_test && <TextTile label={t("Равновесие")} value={t(d.balance_test)} />}
              {d.forward_bend && <TextTile label={t("Наклон вперёд")} value={bendText(d, t)} />}
            </div>
          )}
        </DetailBlock>
      )}

      {d.photo_paths.length > 0 && (
        <DetailBlock icon={Camera} title={t("Фотографии")}>
          <p className="-mt-2 mb-3 text-sm text-muted-foreground">
            {t(
              "Сделаны с вашего разрешения, чтобы видеть динамику. Их видите только вы и тренеры студии.",
            )}
          </p>
          <div className="grid grid-cols-2 gap-2">
            {d.photo_paths.map((p) =>
              urls?.[p] ? (
                <a
                  key={p}
                  href={urls[p]}
                  target="_blank"
                  rel="noreferrer"
                  className="overflow-hidden rounded-xl bg-muted"
                >
                  <img
                    src={urls[p]}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    className="aspect-[3/4] w-full object-cover"
                  />
                </a>
              ) : (
                <div key={p} className="aspect-[3/4] animate-pulse rounded-xl bg-muted" />
              ),
            )}
          </div>
        </DetailBlock>
      )}

      {d.stage != null && (
        <DetailBlock icon={GraphUp} title={t("Этапы тренировочного процесса")}>
          <p className="-mt-2 mb-3 text-sm leading-relaxed text-muted-foreground">
            {t("Каждый этап закрепляет изменения и подготавливает тело к следующему уровню.")}
          </p>
          <div className="space-y-2">
            {STAGES.map((s) => {
              const active = d.stage === s.key;
              return (
                <div
                  key={s.key}
                  className={cn(
                    "relative overflow-hidden rounded-xl p-4",
                    active ? "bg-primary/10 ring-1 ring-primary" : "bg-muted/60",
                  )}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      <span
                        className={cn(
                          "flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold",
                          active
                            ? "bg-primary text-primary-foreground"
                            : "bg-background text-foreground",
                        )}
                      >
                        {s.key}
                      </span>
                      <span className="font-semibold leading-snug">{t(s.title)}</span>
                    </div>
                    <span className="shrink-0 text-xs font-medium text-muted-foreground">
                      {t(s.volume)}
                    </span>
                  </div>
                  {active && (
                    <>
                      <ul className="mt-3 space-y-1.5 text-sm leading-snug text-foreground/80">
                        {s.points.map((p) => (
                          <li key={p} className="flex gap-2">
                            <AltArrowRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                            {t(p)}
                          </li>
                        ))}
                      </ul>
                      <div className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground">
                        <CheckCircle className="h-3.5 w-3.5" weight="Bold" />
                        {t("Ваш текущий этап")}
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </DetailBlock>
      )}

      {(d.rec_trainings || recFocus) && (
        <section className="rounded-2xl bg-[#2A2B2F] p-4 text-white">
          <div className="flex items-center gap-3">
            <TrainerAvatar d={d} size={44} />
            <div>
              <div className="text-xs text-white/60">{t("Персональный план")}</div>
              <h3 className="text-lg font-semibold leading-tight">{t("Рекомендации тренера")}</h3>
            </div>
          </div>
          <div className="mt-4 space-y-2">
            {d.rec_trainings && (
              <Bubble icon={Dumbbell} label={t("Режим тренировок")} text={t(d.rec_trainings)} />
            )}
            {recFocus && <Bubble icon={Target} label={t("Основной акцент")} text={recFocus} />}
          </div>
        </section>
      )}

      <Habits />
    </div>
  );
}

function Bubble({
  icon: Icon,
  label,
  text,
}: {
  icon: ComponentType<{ className?: string; weight?: "BoldDuotone" }>;
  label: string;
  text: string;
}) {
  return (
    <div className="rounded-2xl rounded-tl-sm bg-background p-4 text-foreground">
      <div className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold text-primary">
        <Icon className="h-4 w-4" weight="BoldDuotone" />
        {label}
      </div>
      <p className="whitespace-pre-line text-[15px] leading-relaxed">{text}</p>
    </div>
  );
}

/** «Не только тренировки» — как в карте клиента прежнего продукта. */
const HABITS = [
  {
    icon: Moon,
    title: msg("Сон"),
    text: msg("7–8 часов сна — время, когда тело восстанавливается, а мышцы действительно растут."),
  },
  {
    icon: Leaf,
    title: msg("Питание"),
    text: msg(
      "Достаточно белка, овощей и регулярные приёмы пищи поддерживают прогресс каждый день.",
    ),
  },
  {
    icon: WaterSun,
    title: msg("Вода"),
    text: msg("Около 1,5–2 литров в день — для суставов, мышц и хорошего уровня энергии."),
  },
  {
    icon: Cup,
    title: msg("Восстановление"),
    text: msg("Прогулки, растяжка и дни отдыха снижают стресс и защищают от перетренированности."),
  },
];

function Habits() {
  const t = useT();
  return (
    <section className="rounded-2xl bg-card p-4 ring-1 ring-border/60">
      <div className="text-sm font-medium text-primary">{t("Не только тренировки")}</div>
      <h3 className="mt-0.5 text-lg font-semibold leading-tight">
        {t("Четыре дополнительные опоры вашего результата")}
      </h3>
      <div className="mt-3 grid gap-2">
        {HABITS.map(({ icon: Icon, title, text }) => (
          <div key={title} className="flex items-start gap-3 rounded-xl bg-muted/60 p-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/15">
              <Icon className="h-5 w-5 text-primary" weight="BoldDuotone" />
            </div>
            <div className="min-w-0">
              <div className="font-semibold leading-snug">{t(title)}</div>
              <p className="mt-0.5 text-sm leading-relaxed text-muted-foreground">{t(text)}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
