import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Pause, Play } from "lucide-react";

import { Button } from "@/components/ui/button";
import { InfoNote } from "@/components/ui/form-field";
import { AudioUrlError, audioConfigQuery, fetchAudioUrl } from "@/lib/audio/data";
import { AUDIO_NOT_CONNECTED, DIALOG_TYPE_COLOR, DIALOG_TYPE_LABEL } from "@/lib/audio/labels";
import { formatOffset } from "@/lib/audio/logic";
import type { AaDialog, AaDialogType } from "@/lib/audio/types";

export type PlayerHandle = {
  /** Перемотать к секунде записи и начать воспроизведение. */
  seek: (seconds: number) => void;
};

/**
 * Умеет ли браузер играть Ogg Opus — формат записи смены. Safari не умеет:
 * без предупреждения кнопки ▶ выглядели бы сломанными.
 */
function canPlayOgg(): boolean {
  if (typeof document === "undefined") return true;
  return document.createElement("audio").canPlayType("audio/ogg; codecs=opus") !== "";
}

/**
 * Плеер смены: склеенное аудио дня из сервиса (временная ссылка), лента со
 * всей сменой и отрезками разговоров. Любая метка времени в отчёте управляет
 * им (`seek`). Ссылка живёт ограниченное время: при ошибке воспроизведения
 * берём новую и возвращаемся на то же место (не чаще раза в 30 с).
 */
export const AudioPlayer = forwardRef<
  PlayerHandle,
  {
    recordingId: string;
    dialogs: AaDialog[];
    totalDuration: number | null;
    purged: boolean;
  }
>(function AudioPlayer({ recordingId, dialogs, totalDuration, purged }, ref) {
  const { data: config, isLoading: configLoading } = useQuery(audioConfigQuery);
  const base = config?.url ?? null;
  const audioRef = useRef<HTMLAudioElement>(null);
  const pendingSeek = useRef<number | null>(null);
  const lastRefresh = useRef(0);
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingUrl, setLoadingUrl] = useState(false);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [loaded, setLoaded] = useState<number | null>(null);
  const [oggOk, setOggOk] = useState(true);

  useEffect(() => setOggOk(canPlayOgg()), []);

  const getUrl = useCallback(async () => {
    if (!base) throw new AudioUrlError(AUDIO_NOT_CONNECTED, 0);
    const r = await fetchAudioUrl(base, recordingId);
    return r.url;
  }, [base, recordingId]);

  // Ссылку берём сразу: перемотка из отчёта должна играть с первого нажатия.
  useEffect(() => {
    if (!base || purged) return;
    let cancelled = false;
    setLoadingUrl(true);
    getUrl()
      .then((url) => !cancelled && setSrc(url))
      .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => !cancelled && setLoadingUrl(false));
    return () => {
      cancelled = true;
    };
  }, [base, purged, getUrl]);

  const applySeek = (seconds: number) => {
    const el = audioRef.current;
    if (!el) return;
    if (el.readyState === 0) {
      pendingSeek.current = seconds;
      el.load();
      return;
    }
    el.currentTime = seconds;
    setTime(seconds);
  };

  useImperativeHandle(ref, () => ({
    seek(seconds: number) {
      applySeek(seconds);
      audioRef.current?.play().catch(() => {});
    },
  }));

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const onTime = () => setTime(el.currentTime);
    const onMeta = () => {
      if (Number.isFinite(el.duration)) setLoaded(el.duration);
      if (pendingSeek.current != null) {
        el.currentTime = pendingSeek.current;
        setTime(pendingSeek.current);
        pendingSeek.current = null;
      }
    };
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    // Ссылка протухла (403 на перемотке) или сеть моргнула — новая ссылка и
    // то же место; не чаще раза в 30 с, чтобы настоящая ошибка не зациклилась.
    const onError = async () => {
      const now = Date.now();
      if (now - lastRefresh.current < 30_000) {
        setError("Не удалось воспроизвести запись. Обновите страницу.");
        return;
      }
      lastRefresh.current = now;
      const at = pendingSeek.current ?? el.currentTime;
      const wasPlaying = !el.paused;
      try {
        const url = await getUrl();
        el.src = url;
        pendingSeek.current = at;
        el.load();
        if (wasPlaying) el.play().catch(() => {});
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    };
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("loadedmetadata", onMeta);
    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    el.addEventListener("ended", onPause);
    el.addEventListener("error", onError);
    return () => {
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("loadedmetadata", onMeta);
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
      el.removeEventListener("ended", onPause);
      el.removeEventListener("error", onError);
    };
  }, [getUrl, src]);

  const duration = loaded ?? totalDuration ?? 0;
  const pct = (s: number) => (duration > 0 ? Math.min(100, (s / duration) * 100) : 0);
  const hours = duration > 0 ? Math.floor(duration / 3600) : 0;

  if (purged)
    return (
      <InfoNote variant="muted">Аудио удалено по сроку хранения, текст разбора остался.</InfoNote>
    );
  if (!configLoading && !base) return <InfoNote variant="muted">{AUDIO_NOT_CONNECTED}</InfoNote>;

  const toggle = () => {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) el.play().catch(() => {});
    else el.pause();
  };

  return (
    <div className="space-y-2 rounded-lg border bg-background p-3 shadow-sm">
      {src && <audio ref={audioRef} src={src} preload="none" />}
      <div className="flex items-center gap-3">
        <Button
          size="icon"
          aria-label={playing ? "Пауза" : "Слушать"}
          title={playing ? "Пауза" : "Слушать"}
          disabled={!src}
          onClick={toggle}
        >
          {loadingUrl ? <Loader2 className="animate-spin" /> : playing ? <Pause /> : <Play />}
        </Button>
        <span className="w-16 shrink-0 text-xs tabular-nums text-muted-foreground">
          {formatOffset(time)}
        </span>
        <div className="relative h-6 min-w-0 flex-1">
          <div className="absolute inset-x-0 top-2 h-2 overflow-hidden rounded-full bg-muted">
            {Array.from({ length: hours }, (_, i) => (
              <span
                key={i}
                className="absolute top-0 h-full w-px bg-muted-foreground/30"
                style={{ left: `${pct((i + 1) * 3600)}%` }}
              />
            ))}
            {dialogs
              .filter((d) => d.type !== "irrelevant")
              .map((d) => (
                <span
                  key={d.id}
                  className="absolute top-0 h-full"
                  style={{
                    left: `${pct(d.start_s)}%`,
                    width: `${Math.max(0.35, pct(d.end_s) - pct(d.start_s))}%`,
                    backgroundColor:
                      DIALOG_TYPE_COLOR[d.type as Exclude<AaDialogType, "irrelevant">],
                  }}
                />
              ))}
          </div>
          <span
            className="pointer-events-none absolute top-1 size-4 -translate-x-1/2 rounded-full border-2 border-background bg-foreground"
            style={{ left: `${pct(time)}%` }}
          />
          <input
            type="range"
            min={0}
            max={Math.max(1, Math.floor(duration))}
            step={1}
            value={Math.floor(time)}
            disabled={!src}
            aria-label="Позиция в записи смены"
            onChange={(e) => applySeek(Number(e.target.value))}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-default"
          />
        </div>
        <span className="w-16 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
          {duration ? formatOffset(duration) : "—"}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {(Object.keys(DIALOG_TYPE_COLOR) as (keyof typeof DIALOG_TYPE_COLOR)[]).map((t) => (
          <span key={t} className="inline-flex items-center gap-1.5">
            <span
              className="size-2 rounded-full"
              style={{ backgroundColor: DIALOG_TYPE_COLOR[t] }}
            />
            {DIALOG_TYPE_LABEL[t]}
          </span>
        ))}
        {error && <span className="text-rose-700">{error}</span>}
      </div>
      {!oggOk && (
        <InfoNote variant="warning">
          Этот браузер (Safari) не воспроизводит формат записи — Ogg Opus, поэтому кнопки ▶ работать
          не будут. Откройте отчёт в Chrome, Edge или Firefox.
        </InfoNote>
      )}
    </div>
  );
});
