import { useEffect, useMemo, useRef, useState } from "react";

import { useT } from "@/i18n";
import { METRICS, chartRows, type DiagnosticPoint, type MetricKey } from "./metrics";
import { diagDate, diagShortDate, num } from "./texts";

/**
 * График динамики показателей диагностики (свой SVG: несколько точек и до
 * трёх линий — подключать библиотеку графиков ради этого незачем). Одна шкала
 * на график (группы — metrics.ts, CHART_GROUPS). Цвета линий — розовый
 * бренда, синий и янтарный: проверены на различимость при дальтонизме
 * (скилл dataviz, все пары ≥ 9 ΔE); подписи — цветом текста, не линии.
 * Касание — ближайшая диагностика: вертикальная линия и значения в плашке
 * над графиком (по умолчанию — последняя).
 */

const SERIES_COLORS = ["var(--primary)", "#257de0", "#d28e05"];

const H = 188;
const PAD = { top: 16, right: 18, bottom: 28, left: 34 };

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

/** «Красивые» деления шкалы: шаг 1/2/5 × 10ⁿ, 3–5 линий. */
function niceTicks(min: number, max: number) {
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const span = max - min;
  const raw = span / 3;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? raw;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v * 10) / 10);
  return { lo, hi, ticks };
}

export function ProgressChart({
  list,
  metrics,
}: {
  list: DiagnosticPoint[];
  metrics: MetricKey[];
}) {
  const t = useT();
  const [ref, width] = useWidth<HTMLDivElement>();
  const rows = useMemo(() => chartRows(list, metrics), [list, metrics]);
  const [active, setActive] = useState<number | null>(null);
  const idx = active ?? rows.length - 1;

  const unit = METRICS[metrics[0]].unit;
  const unitLabel = unit === "cm" ? t("см") : unit === "kg" ? t("кг") : "";
  const values = rows.flatMap((r) =>
    metrics.map((k) => r[k]).filter((v): v is number => v != null),
  );
  const scale =
    unit === "score"
      ? { lo: 0, hi: 10, ticks: [0, 5, 10] }
      : niceTicks(Math.min(...values), Math.max(...values));

  const innerW = Math.max(0, width - PAD.left - PAD.right);
  const innerH = H - PAD.top - PAD.bottom;
  const x = (i: number) =>
    PAD.left + (rows.length === 1 ? innerW / 2 : (innerW * i) / (rows.length - 1));
  const y = (v: number) =>
    PAD.top + innerH - ((v - scale.lo) / (scale.hi - scale.lo || 1)) * innerH;

  // Касание/движение пальцем — ближайшая по горизонтали диагностика.
  const pick = (clientX: number, target: SVGSVGElement) => {
    const left = target.getBoundingClientRect().left;
    const px = clientX - left;
    let best = 0;
    for (let i = 1; i < rows.length; i++)
      if (Math.abs(x(i) - px) < Math.abs(x(best) - px)) best = i;
    setActive(best);
  };

  const current = rows[idx];
  // Подписи под осью: при тесноте — каждая вторая (первая и последняя — всегда).
  const every = innerW / Math.max(1, rows.length - 1) < 46 ? 2 : 1;

  return (
    <div>
      {current && (
        <div className="mb-2 flex min-h-[44px] flex-wrap items-end justify-between gap-x-4 gap-y-1">
          <div className="text-xs font-medium text-muted-foreground">
            {diagDate(current.date, t)}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {metrics.map((k, i) =>
              current[k] == null ? null : (
                <div key={k} className="flex items-center gap-1.5">
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: SERIES_COLORS[i] }}
                    aria-hidden="true"
                  />
                  {metrics.length > 1 && (
                    <span className="text-xs text-muted-foreground">{t(METRICS[k].label)}</span>
                  )}
                  <span className="text-sm font-bold tabular-nums">
                    {num(current[k]!, t)}
                    {unitLabel && <span className="ml-0.5 text-xs font-medium">{unitLabel}</span>}
                  </span>
                </div>
              ),
            )}
          </div>
        </div>
      )}
      <div ref={ref} className="w-full">
        {width > 0 && (
          <svg
            width={width}
            height={H}
            role="img"
            aria-label={metrics.map((k) => t(METRICS[k].label)).join(", ")}
            className="touch-pan-y select-none"
            onPointerDown={(e) => pick(e.clientX, e.currentTarget)}
            onPointerMove={(e) => {
              if (e.buttons || e.pointerType === "mouse") pick(e.clientX, e.currentTarget);
            }}
          >
            {/* Сетка — едва заметная, подписи шкалы слева. */}
            {scale.ticks.map((v) => (
              <g key={v}>
                <line
                  x1={PAD.left}
                  x2={width - PAD.right}
                  y1={y(v)}
                  y2={y(v)}
                  stroke="currentColor"
                  className="text-border"
                  strokeDasharray="3 4"
                  strokeWidth={1}
                />
                <text
                  x={PAD.left - 8}
                  y={y(v)}
                  textAnchor="end"
                  dominantBaseline="middle"
                  className="fill-muted-foreground text-[11px] tabular-nums"
                >
                  {num(v, t)}
                </text>
              </g>
            ))}
            {/* Перекрестие выбранной диагностики. */}
            {current && (
              <line
                x1={x(idx)}
                x2={x(idx)}
                y1={PAD.top - 6}
                y2={PAD.top + innerH}
                stroke="currentColor"
                className="text-foreground/25"
                strokeWidth={1}
              />
            )}
            {metrics.map((k, si) => {
              const pts = rows.flatMap((r, i) => (r[k] == null ? [] : [[x(i), y(r[k]!)] as const]));
              const d = pts.map(([px, py], i) => `${i ? "L" : "M"}${px},${py}`).join(" ");
              return (
                <g key={k}>
                  <path
                    d={d}
                    fill="none"
                    stroke={SERIES_COLORS[si]}
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  {rows.map((r, i) =>
                    r[k] == null ? null : (
                      <circle
                        key={r.id}
                        cx={x(i)}
                        cy={y(r[k]!)}
                        r={i === idx ? 6 : 4.5}
                        fill={SERIES_COLORS[si]}
                        stroke="var(--background)"
                        strokeWidth={2}
                      />
                    ),
                  )}
                </g>
              );
            })}
            {rows.map((r, i) =>
              i % every === 0 || i === rows.length - 1 ? (
                <text
                  key={r.id}
                  x={x(i)}
                  y={H - 8}
                  textAnchor={
                    rows.length > 1 && i === 0
                      ? "start"
                      : i === rows.length - 1 && rows.length > 1
                        ? "end"
                        : "middle"
                  }
                  className={`text-[11px] tabular-nums ${i === idx ? "fill-foreground font-semibold" : "fill-muted-foreground"}`}
                >
                  {diagShortDate(r.date, t)}
                </text>
              ) : null,
            )}
          </svg>
        )}
      </div>
      {metrics.length > 1 && (
        // Легенда — всегда при нескольких линиях: цвет не единственный признак.
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
          {metrics.map((k, i) => (
            <span
              key={k}
              className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"
            >
              <span
                className="h-0.5 w-4 rounded-full"
                style={{ backgroundColor: SERIES_COLORS[i] }}
              />
              {t(METRICS[k].label)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** Размытый пример графика с замком — у первой диагностики, динамики ещё нет. */
export function LockedChartTeaser() {
  return (
    <svg
      viewBox="0 0 120 60"
      preserveAspectRatio="none"
      className="h-24 w-full opacity-40 blur-[2px]"
      aria-hidden="true"
    >
      {[15, 30, 45].map((yy) => (
        <line
          key={yy}
          x1="0"
          x2="120"
          y1={yy}
          y2={yy}
          stroke="currentColor"
          className="text-border"
          strokeDasharray="3 3"
          strokeWidth="0.7"
        />
      ))}
      {["M0,12 L60,24 L120,38", "M0,24 L60,38 L120,50", "M0,36 L60,45 L120,52"].map((d, i) => (
        <path
          key={d}
          d={d}
          fill="none"
          stroke={SERIES_COLORS[i]}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>
  );
}
