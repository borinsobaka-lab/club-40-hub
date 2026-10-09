import { useEffect, useState } from "react";

import { supabase } from "@/integrations/supabase/client";
import { getActiveStudioId, setActiveStudioId } from "@/hooks/use-active-studio";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Studio = { id: string; name: string };

// Module-level cache so the switcher doesn't re-fetch / flicker on route changes.
let studiosCache: Studio[] | null = null;
let studiosPromise: Promise<Studio[]> | null = null;

function loadStudios(): Promise<Studio[]> {
  if (studiosCache) return Promise.resolve(studiosCache);
  if (studiosPromise) return studiosPromise;
  studiosPromise = (async () => {
    const { data, error } = await supabase.from("studios").select("id, name").order("name");
    if (error || !data) {
      studiosPromise = null;
      return [];
    }
    studiosCache = data as Studio[];
    return studiosCache;
  })();
  return studiosPromise;
}

export function StudioSwitcher() {
  const [studios, setStudios] = useState<Studio[]>(() => studiosCache ?? []);
  const [active, setActive] = useState<string | null>(() => getActiveStudioId());
  const [loading, setLoading] = useState(() => studiosCache === null);

  useEffect(() => {
    let cancelled = false;
    loadStudios().then((data) => {
      if (cancelled) return;
      setStudios(data);
      const current = getActiveStudioId();
      if (data.length > 0 && (!current || !data.find((s) => s.id === current))) {
        setActive(data[0].id);
        setActiveStudioId(data[0].id);
      }
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const onChange = (value: string) => {
    setActive(value);
    setActiveStudioId(value);
  };

  return (
    <div className="flex items-center gap-2">
      <Select
        value={active ?? undefined}
        onValueChange={onChange}
        disabled={loading || studios.length === 0}
      >
        <SelectTrigger className="h-9 w-[170px] text-sm">
          <SelectValue
            placeholder={
              loading ? "Загрузка…" : studios.length === 0 ? "Нет студий" : "Выберите студию"
            }
          />
        </SelectTrigger>
        <SelectContent>
          {studios.map((s) => (
            <SelectItem key={s.id} value={s.id} className="text-xs">
              {s.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
