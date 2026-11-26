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

export const ADMIN_LINK_TIP =
  "Этот пользователь мобильного приложения — администратор. Ему в приложении откроются «Мои смены» из «Графика» и «Выплаты»: начисления за смены, бонус с продаж по его проценту, платежи по продажам и день выплаты.";

type TrainerOption = { id: string; full_name: string; photo_url: string | null };

/** Связь «пользователь приложения — сотрудник справочника»: тренер или администратор. */
type LinkConfig = {
  table: "app_trainer_links" | "app_admin_links";
  roles: string[];
  label: string;
  tip: string;
  none: string;
  outside: string;
  loadError: string;
  listError: string;
  setToast: string;
  unsetToast: string;
};

const TRAINER_LINK: LinkConfig = {
  table: "app_trainer_links",
  roles: ["trainer"],
  label: "Тренер",
  tip: TRAINER_LINK_TIP,
  none: "Не тренер",
  outside: "Тренер не из клубов сети",
  loadError: "Не удалось загрузить тренера пользователя",
  listError: "Не удалось загрузить тренеров",
  setToast: "Пользователь отмечен как тренер",
  unsetToast: "Отметка «тренер» снята",
};

const ADMIN_LINK: LinkConfig = {
  table: "app_admin_links",
  roles: ["admin", "senior_admin"],
  label: "Администратор",
  tip: ADMIN_LINK_TIP,
  none: "Не администратор",
  outside: "Администратор не из клубов сети",
  loadError: "Не удалось загрузить администратора пользователя",
  listError: "Не удалось загрузить администраторов",
  setToast: "Пользователь отмечен как администратор",
  unsetToast: "Отметка «администратор» снята",
};

/**
 * «Тренер» во вкладке «Приложение» карточки клиента (решение владельца
 * 2026-11-05, пакетные клубы): связь пользователя приложения с тренером
 * справочника — app_trainer_links (db/migrations/2026-11-05_zz_trainer_app.sql).
 * Список — тренеры клубов сети карточки. У карточки один тренер, один
 * тренер может быть у нескольких карточек (2026-11-16_trainer_link_many_cards.sql:
 * сотрудник ставит себе тренера, чтобы проверить приложение под ним).
 */
export function ClientTrainerField(props: { clientId: string; cardStudioId: string | null }) {
  return <StaffLinkField {...props} cfg={TRAINER_LINK} />;
}

/**
 * «Администратор» там же (решение владельца 2026-11-26): пользователь
 * приложения — администратор справочника (роль «Администратор» или
 * «Руководитель студии»), app_admin_links
 * (db/migrations/2026-11-26_zzz_admin_app_payouts.sql). В приложении ему —
 * «Мои смены» и «Выплаты» на главной.
 */
export function ClientAdminField(props: { clientId: string; cardStudioId: string | null }) {
  return <StaffLinkField {...props} cfg={ADMIN_LINK} />;
}

function StaffLinkField({
  clientId,
  cardStudioId,
  cfg,
}: {
  clientId: string;
  cardStudioId: string | null;
  cfg: LinkConfig;
}) {
  const queryClient = useQueryClient();
  const networkIds = useNetworkStudioIds(cardStudioId);
  const [saving, setSaving] = useState(false);

  const { data: link, isLoading: linkLoading } = useQuery({
    queryKey: [cfg.table, clientId],
    queryFn: async () => {
      const rows = await unwrap<{ trainer_id: string }[]>(
        supabase.from(cfg.table).select("trainer_id").eq("client_id", clientId),
      );
      return rows[0]?.trainer_id ?? null;
    },
    meta: { errorMessage: cfg.loadError },
  });

  const { data: trainers = [] } = useQuery({
    queryKey: ["trainers", "app-link-options", cfg.table, (networkIds ?? []).join(",")],
    queryFn: async () => {
      const rows = await unwrap<(TrainerOption & { role: string })[]>(
        supabase
          .from("trainers")
          .select("id, full_name, photo_url, role, trainer_studios!inner(studio_id)")
          .in("trainer_studios.studio_id", networkIds!)
          .in("role", cfg.roles)
          .order("full_name"),
      );
      // Тренер в нескольких клубах приходит строкой на клуб.
      return [...new Map(rows.map((r) => [r.id, r])).values()];
    },
    enabled: !!networkIds?.length,
    meta: { errorMessage: cfg.listError },
  });

  const change = async (value: string) => {
    const trainerId = value === NONE ? null : value;
    if (trainerId === (link ?? null)) return;
    setSaving(true);
    try {
      const { error } = trainerId
        ? await supabase
            .from(cfg.table)
            .upsert({ client_id: clientId, trainer_id: trainerId }, { onConflict: "client_id" })
        : await supabase.from(cfg.table).delete().eq("client_id", clientId);
      if (error) {
        toast.error("Не удалось сохранить: " + error.message);
        return;
      }
      queryClient.setQueryData([cfg.table, clientId], trainerId);
      toast.success(trainerId ? cfg.setToast : cfg.unsetToast);
    } finally {
      setSaving(false);
    }
  };

  return (
    <FormField label={cfg.label} tip={cfg.tip}>
      <Select
        value={link ?? NONE}
        onValueChange={change}
        disabled={linkLoading || saving || !networkIds}
      >
        <SelectTrigger className="w-full sm:w-80" aria-label={cfg.label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>{cfg.none}</SelectItem>
          {/* Указанный сотрудник мог уйти из клубов сети — всё равно показываем. */}
          {link && !trainers.some((t) => t.id === link) && (
            <SelectItem value={link}>{cfg.outside}</SelectItem>
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
