import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useNetworkStudioIds } from "@/hooks/use-catalog-studios";
import { FormField } from "@/components/ui/form-field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StaffOption } from "@/components/employee-photo";
import { unwrap } from "@/lib/query";

const NONE = "none";

export const TRAINER_LINK_TIP =
  "Этот пользователь мобильного приложения — тренер. Ему в приложении откроются «Моё расписание», записанные на его тренировки с анкетами, комментарии тренеров и уведомления об отмене и замене.";

type TrainerOption = { id: string; full_name: string; photo_url: string | null };

/**
 * «Тренер» во вкладке «Приложение» карточки клиента (решение владельца
 * 2026-11-05, пакетные клубы): связь пользователя приложения с тренером
 * справочника — app_trainer_links (db/migrations/2026-11-05_zz_trainer_app.sql).
 * Список — тренеры клубов сети карточки. Один тренер — одна карточка.
 */
export function ClientTrainerField({
  clientId,
  cardStudioId,
}: {
  clientId: string;
  cardStudioId: string | null;
}) {
  const queryClient = useQueryClient();
  const networkIds = useNetworkStudioIds(cardStudioId);
  const [saving, setSaving] = useState(false);

  const { data: link, isLoading: linkLoading } = useQuery({
    queryKey: ["app_trainer_links", clientId],
    queryFn: async () => {
      const rows = await unwrap<{ trainer_id: string }[]>(
        supabase.from("app_trainer_links").select("trainer_id").eq("client_id", clientId),
      );
      return rows[0]?.trainer_id ?? null;
    },
    meta: { errorMessage: "Не удалось загрузить тренера пользователя" },
  });

  const { data: trainers = [] } = useQuery({
    queryKey: ["trainers", "app-trainer-options", (networkIds ?? []).join(",")],
    queryFn: async () => {
      const rows = await unwrap<(TrainerOption & { role: string })[]>(
        supabase
          .from("trainers")
          .select("id, full_name, photo_url, role, trainer_studios!inner(studio_id)")
          .in("trainer_studios.studio_id", networkIds!)
          .eq("role", "trainer")
          .order("full_name"),
      );
      // Тренер в нескольких клубах приходит строкой на клуб.
      return [...new Map(rows.map((r) => [r.id, r])).values()];
    },
    enabled: !!networkIds?.length,
    meta: { errorMessage: "Не удалось загрузить тренеров" },
  });

  const change = async (value: string) => {
    const trainerId = value === NONE ? null : value;
    if (trainerId === (link ?? null)) return;
    setSaving(true);
    try {
      const { error } = trainerId
        ? await supabase
            .from("app_trainer_links")
            .upsert({ client_id: clientId, trainer_id: trainerId }, { onConflict: "client_id" })
        : await supabase.from("app_trainer_links").delete().eq("client_id", clientId);
      if (error) {
        toast.error(
          error.code === "23505"
            ? "Этот тренер уже указан у другого пользователя приложения — сначала уберите его там."
            : "Не удалось сохранить: " + error.message,
        );
        return;
      }
      queryClient.setQueryData(["app_trainer_links", clientId], trainerId);
      toast.success(trainerId ? "Пользователь отмечен как тренер" : "Отметка «тренер» снята");
    } finally {
      setSaving(false);
    }
  };

  return (
    <FormField label="Тренер" tip={TRAINER_LINK_TIP}>
      <Select
        value={link ?? NONE}
        onValueChange={change}
        disabled={linkLoading || saving || !networkIds}
      >
        <SelectTrigger className="w-full sm:w-80" aria-label="Тренер">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>Не тренер</SelectItem>
          {/* Указанный тренер мог уйти из клубов сети — всё равно показываем. */}
          {link && !trainers.some((t) => t.id === link) && (
            <SelectItem value={link}>Тренер не из клубов сети</SelectItem>
          )}
          {trainers.map((t) => (
            <SelectItem key={t.id} value={t.id} textValue={t.full_name}>
              <StaffOption name={t.full_name} photo={t.photo_url} />
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </FormField>
  );
}
