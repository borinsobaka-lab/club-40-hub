import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { AUDIO_KEY } from "@/lib/audio/data";

export type AudioPerson = {
  user_id: string;
  full_name: string | null;
  email: string | null;
  avatar_url: string | null;
};

/**
 * Люди портала для связи менеджера с учётной записью (RPC aa_people — только
 * «Аудиоаналитика: настройки»). null — справочник закрыт.
 */
export function useAudioPeople(enabled: boolean) {
  return useQuery({
    queryKey: [AUDIO_KEY, "people"],
    queryFn: async (): Promise<AudioPerson[] | null> => {
      const { data, error } = await supabase.rpc("aa_people");
      if (error) return null;
      return (data ?? []) as AudioPerson[];
    },
    enabled,
    staleTime: 5 * 60_000,
  });
}
