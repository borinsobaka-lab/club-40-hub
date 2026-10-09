import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { useClientStudioId } from "@/hooks/use-client-studio";
import { APP_FORMAT, type StudioFormat } from "@/lib/app-format";

export type Studio = {
  id: string;
  name: string;
  format: StudioFormat;
  /** Основной цвет студии (#rrggbb). В приложении пока не применяется. */
  brand_color: string;
  /** Путь в бакете studio-logos или полный URL. */
  logo_url: string | null;
};

const STUDIO_COLUMNS = "id, name, format, brand_color, logo_url";

// Таблица studios читается публично (db/studio_formats.sql), в том числе до
// входа. Пока миграция не выполнена, колонки format нет и запросы падают —
// тогда хуки отдают undefined, и приложение ведёт себя как до разделения
// форматов (без выбора студии и без проверки формата).

/** Студии формата этого приложения — для выбора при регистрации. */
export function useFormatStudios() {
  return useQuery({
    queryKey: ["studios", APP_FORMAT],
    queryFn: async (): Promise<Studio[]> => {
      const { data, error } = await supabase
        .from("studios")
        .select(STUDIO_COLUMNS)
        .eq("format", APP_FORMAT)
        .order("created_at");
      if (error) throw error;
      return (data ?? []) as Studio[];
    },
    staleTime: 5 * 60_000,
    retry: false,
  });
}

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
