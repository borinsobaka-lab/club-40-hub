import { useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FileUp, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { AdminShell } from "@/components/admin-shell";
import { AaCard } from "@/components/audio/parts";
import { useConfirm } from "@/components/confirm-dialog";
import { AudioAppPageSkeleton } from "@/components/page-skeletons";
import { RowContextMenu } from "@/components/row-context-menu";
import { TableSkeletonRows } from "@/components/skeletons";
import { Button } from "@/components/ui/button";
import { FormField, InfoNote } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusChip } from "@/components/ui/status-chip";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useTableSort } from "@/hooks/use-table-sort";
import { supabase } from "@/integrations/supabase/client";
import {
  aaReleasesQuery,
  aaServiceStateQuery,
  aaServiceStatusQuery,
  aaWrite,
  audioConfigQuery,
  invalidateAudio,
  uploadRelease,
} from "@/lib/audio/data";
import {
  AUDIO_NOT_CONNECTED,
  AUDIO_TITLES,
  PLATFORM_LABEL,
  RELEASES_COLUMNS,
} from "@/lib/audio/labels";
import { compareVersions, formatDuration, formatSize, workerAlive } from "@/lib/audio/logic";
import type { AaRelease } from "@/lib/audio/types";
import { formatDateTime } from "@/lib/format";
import { sortRows } from "@/lib/table-sort";

export const Route = createFileRoute("/_authenticated/audio/app")({
  head: () => ({ meta: [{ title: "Приложение — Аудиоаналитика — Base40 Admin" }] }),
  pendingComponent: AudioAppPageSkeleton,
  component: AppPage,
});

type Platform = AaRelease["platform"];

const TIPS = {
  published:
    "Раздаётся — приложения на ресепшенах увидят «Вышла новая версия» и обновятся по кнопке. Снятая версия остаётся в списке, но не раздаётся.",
  size: "Размер архива сборки.",
};

/**
 * Приложение записи: состояние сервиса разбора, сборки приложения (апдейтер
 * Tauri — подпись проверяется вшитым ключом) и загрузка новой версии.
 */
function AppPage() {
  const { data: config, isLoading: configLoading } = useQuery(audioConfigQuery);
  const base = config?.url ?? null;
  return (
    <AdminShell title={AUDIO_TITLES.app}>
      <div className="space-y-3">
        {!configLoading && !base && <InfoNote variant="warning">{AUDIO_NOT_CONNECTED}</InfoNote>}
        <ServiceCard base={base} loading={configLoading} />
        <UploadCard base={base} />
        <ReleasesTable />
        <InfoNote variant="muted">
          Адрес сервера и ключ приложения вшиваются в сборку (<code>AA_SERVER_URL</code>,{" "}
          <code>AA_APP_KEY</code>): в студии ничего настраивать не нужно — сотрудник только выбирает
          точку продажи. Сборка — по инструкции <code>apps/recorder/README</code>; номер версии в
          ней должен быть выше прошлой, с тем же номером сервис сборку не примет.
        </InfoNote>
      </div>
    </AdminShell>
  );
}

function Flag({ ok, label }: { ok: boolean | null; label: string }) {
  return (
    <StatusChip tone={ok === null ? "neutral" : ok ? "positive" : "negative"}>
      {label}: {ok === null ? "неизвестно" : ok ? "да" : "нет"}
    </StatusChip>
  );
}

function ServiceCard({ base, loading }: { base: string | null; loading: boolean }) {
  const status = useQuery(aaServiceStatusQuery(base));
  const state = useQuery({ ...aaServiceStateQuery, enabled: !base || status.isError });
  const s = status.data;
  const alive = workerAlive(s?.worker_heartbeat_age_s);
  const last = (state.data ?? []).reduce<string | null>(
    (m, r) => (!m || r.updated_at > m ? r.updated_at : m),
    null,
  );

  return (
    <AaCard
      title="Сервис разбора"
      tip="Состояние сервиса на сервере: жив ли воркер (разбирает смены), очередь, что настроено. Обновляется раз в 30 секунд."
      hint={base ?? undefined}
    >
      {loading || (base && status.isLoading) ? (
        <div className="space-y-2">
          <Skeleton className="h-5 w-64" />
          <Skeleton className="h-5 w-96 max-w-full" />
        </div>
      ) : s ? (
        <div className="space-y-2 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <StatusChip tone={alive ? "positive" : "negative"}>
              {alive ? "Воркер работает" : "Воркер не отвечает"}
            </StatusChip>
            <span className="text-xs text-muted-foreground">
              {s.worker_heartbeat_age_s == null
                ? "сигнала от воркера ещё не было"
                : `последний сигнал ${formatDuration(s.worker_heartbeat_age_s)} назад`}
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            <StatusChip tone="info">В очереди: {s.queued ?? "—"}</StatusChip>
            <StatusChip tone="info">Разбирается: {s.processing ?? "—"}</StatusChip>
            <Flag ok={s.asr_configured} label="Распознавание речи" />
            <Flag ok={s.llm_configured} label="Модель" />
            <Flag ok={s.app_key_set} label="Ключ приложения" />
          </div>
          <p className="text-xs text-muted-foreground">
            {s.version && `Версия сервиса ${s.version}`}
            {s.storage && ` · хранилище: ${s.storage}`}
            {Object.entries(s.models).length > 0 &&
              ` · модели: ${Object.entries(s.models)
                .map(([k, v]) => `${k} — ${v}`)
                .join(", ")}`}
          </p>
        </div>
      ) : (
        <div className="space-y-1 text-sm text-muted-foreground">
          <p>
            {base
              ? `Сервис не ответил на запрос состояния${status.error ? `: ${status.error.message}` : "."}`
              : "Состояние сервиса недоступно без AUDIO_API_URL."}
          </p>
          {last && <p>Последний сигнал сервиса в базе: {formatDateTime(last)}.</p>}
        </div>
      )}
    </AaCard>
  );
}

function FilePick({
  label,
  accept,
  file,
  onPick,
  disabled,
}: {
  label: string;
  accept: string;
  file: File | null;
  onPick: (f: File | null) => void;
  disabled?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className="flex min-w-0 items-center gap-2">
      <input
        ref={ref}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => onPick(e.target.files?.[0] ?? null)}
      />
      <Button variant="outline" disabled={disabled} onClick={() => ref.current?.click()}>
        <FileUp />
        {label}
      </Button>
      <span className="min-w-0 truncate text-sm text-muted-foreground" title={file?.name}>
        {file ? `${file.name} · ${formatSize(file.size)}` : "не выбран"}
      </span>
    </div>
  );
}

function UploadCard({ base }: { base: string | null }) {
  const qc = useQueryClient();
  const [archive, setArchive] = useState<File | null>(null);
  const [signature, setSignature] = useState<File | null>(null);
  const [platform, setPlatform] = useState<Platform>("darwin");
  const [version, setVersion] = useState("");
  const [notes, setNotes] = useState("");
  const [progress, setProgress] = useState<number | null>(null);
  const busy = progress !== null;

  const submit = async () => {
    if (!base) return;
    if (!archive || !signature) {
      toast.error("Выберите архив сборки и файл подписи .sig");
      return;
    }
    const form = new FormData();
    form.append("archive", archive);
    form.append("signature_file", signature);
    form.append("platform", platform);
    if (version.trim()) form.append("version", version.trim());
    form.append("notes", notes.trim());
    setProgress(0);
    try {
      const r = await uploadRelease(base, form, setProgress);
      toast.success(
        `Версия ${r.version || version} выложена. Приложения увидят её в течение часа или сразу по «Проверить обновления».`,
      );
      setArchive(null);
      setSignature(null);
      setVersion("");
      setNotes("");
      await invalidateAudio(qc);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось выложить сборку");
    } finally {
      setProgress(null);
    }
  };

  return (
    <section className="space-y-4 rounded-lg border bg-background p-4">
      <h2 className="text-lg font-semibold">Выложить новую версию</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Архив сборки (.app.tar.gz)" required htmlFor={null}>
          <FilePick
            label="Выбрать архив"
            accept=".gz,.tgz,.zip,application/gzip"
            file={archive}
            onPick={setArchive}
            disabled={!base || busy}
          />
        </FormField>
        <FormField
          label="Подпись (.sig)"
          required
          htmlFor={null}
          hint="Тот же файл с .sig на конце — лежит рядом в папке сборки."
        >
          <FilePick
            label="Выбрать подпись"
            accept=".sig"
            file={signature}
            onPick={setSignature}
            disabled={!base || busy}
          />
        </FormField>
      </div>
      <div className="grid gap-4 sm:grid-cols-[auto_12rem_minmax(0,1fr)]">
        <FormField label="Платформа" required htmlFor={null}>
          <SegmentedControl
            aria-label="Платформа"
            value={platform}
            onChange={setPlatform}
            options={(Object.keys(PLATFORM_LABEL) as Platform[]).map((p) => ({
              value: p,
              label: PLATFORM_LABEL[p],
            }))}
          />
        </FormField>
        <FormField label="Версия" optional tip="Пусто — сервис возьмёт номер из сборки.">
          <Input
            value={version}
            onChange={(e) => setVersion(e.target.value)}
            placeholder="1.4.0"
            disabled={!base || busy}
          />
        </FormField>
        <FormField label="Что изменилось" optional hint="Увидят на ресепшене в окне обновления.">
          <Input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Например: видно выбранный микрофон"
            disabled={!base || busy}
          />
        </FormField>
      </div>
      {progress !== null && (
        <div className="space-y-1">
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-foreground/70 transition-[width]"
              style={{ width: `${Math.round(progress * 100)}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            {progress < 1
              ? `Загружаем… ${Math.round(progress * 100)}%`
              : "Сервис проверяет подпись и сохраняет сборку…"}
          </p>
        </div>
      )}
      <Button disabled={!base || busy} onClick={() => void submit()}>
        {busy && <Loader2 className="animate-spin" />}
        Выложить
      </Button>
    </section>
  );
}

function ReleasesTable() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery(aaReleasesQuery);
  const { confirm, confirmDialog } = useConfirm();
  const [busy, setBusy] = useState<string | null>(null);
  const sort = useTableSort();
  const rows = sortRows(data ?? [], sort.sort, {
    platform: (r) => r.platform,
    size: (r) => r.size_bytes,
    created: (r) => r.created_at,
  });
  const sorted =
    sort.sort?.key === "version"
      ? [...(data ?? [])].sort(
          (a, b) => (sort.sort?.dir === "desc" ? -1 : 1) * compareVersions(a.version, b.version),
        )
      : rows;
  const keys = ["version", "platform", "size", "created", null];

  const toggle = async (r: AaRelease, published: boolean) => {
    setBusy(r.id);
    try {
      await aaWrite(supabase.from("aa_app_releases").update({ published }).eq("id", r.id));
      await invalidateAudio(qc);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось сохранить");
    } finally {
      setBusy(null);
    }
  };

  const remove = async (r: AaRelease) => {
    const ok = await confirm({
      title: `Удалить версию ${r.version}?`,
      description: `Архив сборки (${PLATFORM_LABEL[r.platform]}) сотрётся из хранилища вместе с записью о версии.`,
    });
    if (!ok) return;
    try {
      await aaWrite(supabase.from("aa_app_releases").delete().eq("id", r.id));
      await invalidateAudio(qc);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось удалить");
    }
  };

  return (
    <section className="min-w-0 rounded-lg border bg-background">
      <div className="border-b px-3 py-2 sm:px-4">
        <h3 className="text-sm font-semibold">Сборки</h3>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            {RELEASES_COLUMNS.map((c, i) => (
              <TableHead
                key={c}
                className={i === 2 ? "text-right [&>span]:justify-end" : undefined}
                tip={i === 4 ? TIPS.published : i === 2 ? TIPS.size : undefined}
                {...(keys[i] ? sort.head(keys[i]!) : {})}
              >
                {c}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            <TableSkeletonRows columns={RELEASES_COLUMNS.length} rows={3} />
          ) : sorted.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={RELEASES_COLUMNS.length}
                className="py-8 text-center text-sm text-muted-foreground"
              >
                Сборок пока нет — выложите архив и подпись из папки сборки.
              </TableCell>
            </TableRow>
          ) : (
            sorted.map((r) => (
              <RowContextMenu
                key={r.id}
                actions={[
                  {
                    label: "Удалить",
                    icon: Trash2,
                    destructive: true,
                    onSelect: () => void remove(r),
                  },
                ]}
              >
                <TableRow>
                  <TableCell className="min-w-48 whitespace-normal">
                    <span className="font-medium">{r.version}</span>
                    {r.notes && (
                      <span className="block text-xs text-muted-foreground">{r.notes}</span>
                    )}
                  </TableCell>
                  <TableCell>{PLATFORM_LABEL[r.platform] ?? r.platform}</TableCell>
                  <TableCell className="text-right">{formatSize(r.size_bytes)}</TableCell>
                  <TableCell>
                    {formatDateTime(r.created_at)}
                    {r.created_by_name && (
                      <span className="block text-xs text-muted-foreground">
                        {r.created_by_name}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Switch
                      checked={r.published}
                      disabled={busy === r.id}
                      aria-label={r.published ? "Перестать раздавать" : "Раздавать"}
                      onCheckedChange={(v) => void toggle(r, v)}
                    />
                  </TableCell>
                </TableRow>
              </RowContextMenu>
            ))
          )}
        </TableBody>
      </Table>
      {confirmDialog}
    </section>
  );
}
