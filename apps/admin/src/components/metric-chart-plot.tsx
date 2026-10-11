import { useId } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { formatNumber } from "@/lib/format";

/**
 * Сам график из окна показателя на дашборде (MetricChart в
 * components/dashboard/stat-cards.tsx). Вынесен в свой файл ради отдельного
 * чанка: recharts (~100 kB gzip) грузится, только когда окно открыли.
 */

export type ChartType = "bar" | "line" | "area";

export type ChartPoint = {
  tick: string;
  label: string;
  value: number | null;
  /** Число продаж в корзине (для среднего чека). */
  n: number;
};

const compactNumber = new Intl.NumberFormat("ru-RU", {
  notation: "compact",
  maximumFractionDigits: 1,
});

export function MetricChartPlot({
  data,
  chartType,
  color,
  dots,
  format,
  showDeals,
}: {
  data: ChartPoint[];
  chartType: ChartType;
  color: string;
  /** Точки на линии (по дням их слишком много). */
  dots: boolean;
  format: (n: number) => string;
  /** Показывать в подсказке число продаж (средние показатели). */
  showDeals: boolean;
}) {
  const gradientId = `chart-fill-${useId().replace(/:/g, "")}`;

  const axis = {
    tick: { fontSize: 11, fill: "var(--muted-foreground)" },
    tickLine: false,
    axisLine: false,
  };
  const tooltip = (
    <Tooltip
      cursor={
        chartType === "bar"
          ? { fill: "var(--muted)", opacity: 0.6 }
          : { stroke: "var(--border)", strokeWidth: 1 }
      }
      content={({ active, payload }) => {
        const row = active ? payload?.[0]?.payload : null;
        if (!row) return null;
        return (
          <div className="rounded-lg border bg-popover px-3 py-2 text-xs shadow-md">
            <div className="font-medium first-letter:uppercase">{row.label}</div>
            <div className="mt-1 text-sm font-semibold tabular-nums">
              {row.value === null ? "нет продаж" : format(row.value)}
            </div>
            {showDeals && row.n > 0 && (
              <div className="text-muted-foreground">продаж: {formatNumber(row.n)}</div>
            )}
          </div>
        );
      }}
    />
  );
  const common = { data, margin: { top: 8, right: 8, bottom: 0, left: 0 } };
  const grid = <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />;
  const xAxis = (
    <XAxis dataKey="tick" {...axis} interval="preserveStartEnd" minTickGap={12} tickMargin={8} />
  );
  const yAxis = (
    <YAxis {...axis} width={64} allowDecimals={false} tickFormatter={compactNumber.format} />
  );

  return (
    <ResponsiveContainer width="100%" height="100%">
      {chartType === "bar" ? (
        <BarChart {...common}>
          {grid}
          {xAxis}
          {yAxis}
          {tooltip}
          <Bar dataKey="value" fill={color} radius={[4, 4, 0, 0]} maxBarSize={48} />
        </BarChart>
      ) : chartType === "line" ? (
        <LineChart {...common}>
          {grid}
          {xAxis}
          {yAxis}
          {tooltip}
          <Line
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={2}
            dot={dots ? { r: 3, fill: color } : false}
            activeDot={{ r: 5 }}
          />
        </LineChart>
      ) : (
        <AreaChart {...common}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.35} />
              <stop offset="100%" stopColor={color} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          {grid}
          {xAxis}
          {yAxis}
          {tooltip}
          <Area
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={2}
            fill={`url(#${gradientId})`}
            activeDot={{ r: 5 }}
          />
        </AreaChart>
      )}
    </ResponsiveContainer>
  );
}
