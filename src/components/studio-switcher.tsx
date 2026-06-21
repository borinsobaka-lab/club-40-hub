import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Studio = { id: string; name: string };

const STORAGE_KEY = "club40.activeStudioId";

export function getActiveStudioId(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(STORAGE_KEY);
}

export function setActiveStudioId(id: string) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, id);
  window.dispatchEvent(new CustomEvent("club40:studio-changed", { detail: id }));
}

export function useActiveStudioId(): string | null {
  const [id, setId] = useState<string | null>(() => getActiveStudioId());
  useEffect(() => {
    const handler = (e: Event) => setId((e as CustomEvent<string>).detail);
    window.addEventListener("club40:studio-changed", handler);
    return () => window.removeEventListener("club40:studio-changed", handler);
  }, []);
  return id;
}

export function StudioSwitcher() {
  const [studios, setStudios] = useState<Studio[]>([]);
  const [active, setActive] = useState<string | null>(() => getActiveStudioId());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("studios")
        .select("id, name")
        .order("name");
      if (cancelled) return;
      if (error || !data) {
        setStudios([]);
      } else {
        setStudios(data as Studio[]);
        if (data.length > 0 && (!active || !data.find((s) => s.id === active))) {
          setActive(data[0].id);
          setActiveStudioId(data[0].id);
        }
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onChange = (value: string) => {
    setActive(value);
    setActiveStudioId(value);
  };

  return (
    <div className="flex items-center gap-2">
      <Select value={active ?? undefined} onValueChange={onChange} disabled={loading || studios.length === 0}>
        <SelectTrigger className="h-8 w-[170px] text-xs">
          <SelectValue
            placeholder={loading ? "Загрузка…" : studios.length === 0 ? "Нет студий" : "Выберите студию"}
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
