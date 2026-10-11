import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { useClientStudioId } from "@/hooks/use-client-studio";
import type { StudioFormat } from "@/lib/app-format";

export type Studio = {
  id: string;
  name: string;
  format: StudioFormat;
  /** Основной цвет студии (#rrggbb). В приложении пока не применяется. */
  brand_color: string;
  /** Путь в бакете studio-logos или полный URL. */
  logo_url: string | null;
  /** Адрес одной строкой (db/migrations/…_studio_address.sql) — только в useFormatStudios. */
  address?: string | null;
};

const STUDIO_COLUMNS = "id, name, format, brand_color, logo_url";

// Таблица studios читается публично (db/migrations/2026-10-09_studio_formats.sql), в том числе до
// входа. Пока миграция не выполнена, колонки format нет и запросы падают —
// тогда хук отдаёт null, и приложение ведёт себя как до разделения
// форматов (без проверки формата).

/** Студия текущего клиента (по карточке clients.studio_id). */
export function useClientStudio(): Studio | null {
  const { studioId } = useClientStudioId();
  const { data } = useQuery({
    queryKey: ["studio", studioId],
    queryFn: async (): Promise<Studio | null> => {
      const { data, error } = await supabase
        .from("studios")
        .select(STUDIO_COLUMNS)
        .eq("id", studioId!)
        .maybeSingle();
      if (error) throw error;
      return (data as Studio | null) ?? null;
    },
    enabled: !!studioId,
    staleTime: 5 * 60_000,
    retry: false,
  });
  return data ?? null;
}
