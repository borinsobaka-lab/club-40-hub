import type React from "react";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { CardSkeleton } from "@/components/skeletons";
import { InfoNote } from "@/components/ui/form-field";
import { StatusChip } from "@/components/ui/status-chip";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  BODY_DIAGNOSTIC_COLUMNS,
  DIAGNOSTIC_PHOTO_BUCKET,
  STAGE_TITLES,
  bendText,
  diffText,
  dynamicsTable,
  fmtNum,
  num,
  recFocusText,
  type BodyDiagnosticRow,
  type DynamicsRow,
} from "@/lib/body-diagnostics";
import { formatDate, formatDateTime } from "@/lib/format";
import { unwrap } from "@/lib/query";
import { cn } from "@/lib/utils";

/**
 * Вкладка «Диагностика» карточки клиента (решение владельца 2026-11-27):
 * результаты диагностики тела, которые тренер заполнил в мобильном
 * приложении (body_diagnostics; читают сотрудники клубов, которым видна
 * карточка, — RLS). Две и больше — сверху таблица «Динамика» (показатель ×
 * дата и изменение от первой к последней), ниже — каждая диагностика
 * целиком, свежая раскрыта. Сотруднику видно всё, что заполнил тренер, в
 * том числе его комментарии (клиент их в приложении не видит). Только
 * чтение: правит тренер в приложении в течение 14 дней.
 */
export function ClientDiagnosticsTab({ clientId }: { clientId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["body_diagnostics", clientId],
    queryFn: () =>
      unwrap<BodyDiagnosticRow[]>(
        supabase
          .from("body_diagnostics")
          .select(BODY_DIAGNOSTIC_COLUMNS)
          .eq("client_id", clientId)
          .order("diagnostic_date", { ascending: false })
          .order("updated_at", { ascending: false }),
      ),
    meta: { errorMessage: "Не удалось загрузить диагностики клиента" },
  });

  if (isLoading) return <CardSkeleton rows={4} />;
  if (!data || data.length === 0) {
    return (
      <InfoNote variant="empty">
        Диагностик пока нет. Их заполняет тренер в мобильном приложении — кнопкой «Заполнить» у
        диагностики в своём расписании; клиент видит результаты в приложении, во вкладке
        «Диагностика».
      </InfoNote>
    );
  }

  return (
    <div className="space-y-5">
      {data.length > 1 && <Dynamics list={data} />}
      <div className="space-y-3">
        {data.map((d, i) => (
          <DiagnosticCard key={d.id} d={d} number={data.length - i} defaultOpen={i === 0} />
        ))}
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="text-xs font-medium uppercase text-muted-foreground">{children}</div>;
}

const TREND_TONE: Record<NonNullable<DynamicsRow["trend"]>, "positive" | "warning" | "neutral"> = {
  better: "positive",
  worse: "warning",
  changed: "neutral",
  same: "neutral",
};

function Dynamics({ list }: { list: BodyDiagnosticRow[] }) {
  const { dates, rows } = dynamicsTable(list);
  if (rows.length === 0) return null;
  return (
    <div className="space-y-2">
      <SectionLabel>Динамика</SectionLabel>
      <div className="overflow-x-auto rounded-lg border bg-background">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Показатель</TableHead>
              {dates.map((d, i) => (
                <TableHead key={`${d}-${i}`} className="text-right">
                  {formatDate(d)}
                </TableHead>
              ))}
              <TableHead className="text-right">Изменение</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.key}>
                <TableCell className="font-medium">{r.label}</TableCell>
                {r.values.map((v, i) => (
                  <TableCell key={i} className="text-right tabular-nums">
                    {v == null ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <>
                        {fmtNum(v)}
                        <span className="ml-1 text-xs text-muted-foreground">{r.unit}</span>
                      </>
                    )}
                  </TableCell>
                ))}
                <TableCell className="text-right">
                  {r.diff == null || !r.trend ? (
                    <span className="text-muted-foreground">—</span>
                  ) : (
                    <StatusChip tone={TREND_TONE[r.trend]}>{diffText(r.diff, r.unit)}</StatusChip>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <p className="text-xs text-muted-foreground">
        Зелёным — улучшение: шпагаты и наклон ближе к полу, самочувствие и активность выше. Объёмы и
        вес не оцениваются — у каждой клиентки своя цель.
      </p>
    </div>
  );
}

function DiagnosticCard({
  d,
  number,
  defaultOpen,
}: {
  d: BodyDiagnosticRow;
  number: number;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const trainer = d.trainer?.full_name ?? d.trainer_name;
  return (
    <div className="rounded-lg border bg-background">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-3 py-2.5 text-left"
      >
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold tabular-nums">
          {number}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">
            Диагностика {formatDate(d.diagnostic_date)}
          </span>
          <span className="block truncate text-xs text-muted-foreground">
            {[trainer, d.studio?.name ? `клуб «${d.studio.name}»` : null]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </span>
        {d.stage != null && (
          <StatusChip tone="strong" className="max-sm:hidden">
            Этап {d.stage}
          </StatusChip>
        )}
        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
        />
      </button>
      {open && <DiagnosticBody d={d} />}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[10rem_minmax(0,1fr)] gap-3 py-1.5 text-sm max-sm:grid-cols-1 max-sm:gap-0.5">
      <div className="text-muted-foreground">{label}</div>
      <div className="min-w-0 whitespace-pre-wrap break-words">{children}</div>
    </div>
  );
}

/** Комментарий тренера — мелко под значением. */
function TrainerNote({ text }: { text: string | null }) {
  if (!text?.trim()) return null;
  return (
    <div className="mt-1 rounded-md bg-note px-2 py-1 text-xs text-note-foreground">
      Тренер: {text.trim()}
    </div>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-t px-3 py-3">
      <SectionLabel>{title}</SectionLabel>
      <div className="mt-1.5 divide-y divide-border/60">{children}</div>
    </div>
  );
}

function cm(v: number | string | null) {
  const n = num(v);
  return n == null ? null : `${fmtNum(n)} см`;
}

function DiagnosticBody({ d }: { d: BodyDiagnosticRow }) {
  const measures = [
    ["Грудь", cm(d.chest_cm)],
    ["Талия", cm(d.waist_cm)],
    ["Бёдра", cm(d.hips_cm)],
    ["Вес", num(d.weight_kg) == null ? null : `${fmtNum(num(d.weight_kg)!)} кг`],
  ].filter((m): m is [string, string] => m[1] != null);
  const splits = [
    ["Правый продольный", cm(d.split_right_cm)],
    ["Левый продольный", cm(d.split_left_cm)],
    ["Поперечный", cm(d.split_middle_cm)],
  ].filter((m): m is [string, string] => m[1] != null);
  const restrictions = d.restrictions ?? [];
  const focus = recFocusText(d);

  return (
    <>
      <Block title="Клиент">
        <Row label="Дата рождения">{formatDate(d.birth_date)}</Row>
        <Row label="Уровень активности">
          {d.activity_level != null ? `${d.activity_level} из 10` : "—"}
        </Row>
        <Row label="Эмоциональное состояние">
          {d.emotional_level != null ? `${d.emotional_level} из 10` : "—"}
          <TrainerNote text={d.emotional_comment} />
        </Row>
        <Row label="Первое занятие">{(d.directions ?? []).join(", ") || "—"}</Row>
      </Block>

      <Block title="Здоровье">
        <Row label="Ограничения">
          {d.no_restrictions
            ? "Ограничений нет"
            : restrictions.length > 0
              ? restrictions.join(", ")
              : "—"}
        </Row>
        {!d.no_restrictions && d.restrictions_other && (
          <Row label="Другое">{d.restrictions_other}</Row>
        )}
      </Block>

      <Block title="Цели">
        <Row label="Цели">{(d.goals ?? []).join(", ") || "—"}</Row>
        <Row label="Актуально сегодня">{d.priority_today || "—"}</Row>
      </Block>

      <Block title="Замеры">
        {d.measure_skipped ? (
          <Row label="Обхваты и вес">Клиент отказался от замеров</Row>
        ) : (
          <Row label="Обхваты и вес">
            {measures.length ? measures.map(([l, v]) => `${l} ${v}`).join(" · ") : "—"}
          </Row>
        )}
        <Row label="Равновесие">
          {d.balance_test ?? "—"}
          <TrainerNote text={d.balance_comment} />
        </Row>
        <Row label="Наклон вперёд">
          {bendText(d) ?? "—"}
          <TrainerNote text={d.forward_bend_comment} />
        </Row>
        <Row label="Шпагат, до пола">
          {splits.length ? splits.map(([l, v]) => `${l} ${v}`).join(" · ") : "—"}
        </Row>
      </Block>

      {(d.photo_paths ?? []).length > 0 && (
        <Block title="Фото">
          <Photos paths={d.photo_paths ?? []} />
        </Block>
      )}

      <Block title="Рекомендации">
        <Row label="Этап">{d.stage != null ? `${d.stage} — ${STAGE_TITLES[d.stage]}` : "—"}</Row>
        <Row label="Тренировки">{d.rec_trainings || "—"}</Row>
        <Row label="Основной акцент">{focus || "—"}</Row>
      </Block>
      <div className="border-t px-3 py-2 text-xs text-muted-foreground">
        Заполнено: {formatDateTime(d.updated_at)}
      </div>
    </>
  );
}

/** Фото — из закрытого бакета по подписанным ссылкам; нажатие открывает целиком. */
function Photos({ paths }: { paths: string[] }) {
  const { data: urls } = useQuery({
    queryKey: ["body_diagnostic_photos", paths],
    queryFn: async () => {
      const { data, error } = await supabase.storage
        .from(DIAGNOSTIC_PHOTO_BUCKET)
        .createSignedUrls(paths, 3600);
      if (error) throw error;
      const out: Record<string, string> = {};
      for (const r of data ?? []) if (r.path && r.signedUrl) out[r.path] = r.signedUrl;
      return out;
    },
    staleTime: 50 * 60_000,
    meta: { errorMessage: "Не удалось загрузить фото диагностики" },
  });
  return (
    <div className="grid grid-cols-3 gap-2 py-1.5 sm:grid-cols-5">
      {paths.map((p) =>
        urls?.[p] ? (
          <a
            key={p}
            href={urls[p]}
            target="_blank"
            rel="noreferrer"
            className="overflow-hidden rounded-md border bg-muted"
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
          <div key={p} className="aspect-[3/4] animate-pulse rounded-md bg-muted" />
        ),
      )}
    </div>
  );
}
