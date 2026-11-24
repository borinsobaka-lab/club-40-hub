import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import type { PayScheme, SchemeWorkout } from "@/lib/pay-schemes";
import { unwrap } from "@/lib/query";

export const SCHEMES_KEY = "trainer_pay_schemes";

/**
 * Суммы прогрессивной ставки: схемы и их тренировки всех сотрудников,
 * видимых вызывающему (их немного — несколько строк на тренера). Читают
 * «Ставки» и окно схем тренера (components/trainer-pay-schemes.tsx).
 */
export function useTrainerPaySchemes() {
  return useQuery({
    queryKey: [SCHEMES_KEY],
    queryFn: async () => {
      const [list, links] = await Promise.all([
        unwrap<PayScheme[]>(
          supabase.from("trainer_pay_schemes").select("*").order("sort_order").order("created_at"),
        ),
        unwrap<SchemeWorkout[]>(
          supabase.from("trainer_pay_scheme_workouts").select("trainer_id, scheme_id, workout_id"),
        ),
      ]);
      return { list, links };
    },
    meta: { errorMessage: "Не удалось загрузить суммы прогрессивной ставки" },
  });
}
