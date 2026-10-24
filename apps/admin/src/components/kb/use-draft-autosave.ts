import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { KB_DRAFTS_KEY } from "@/lib/kb/data";

export type AutosaveState = "idle" | "pending" | "saving" | "saved" | "error" | "conflict";

const DELAY_MS = 1200;

/**
 * Автосохранение черновика статьи на сервер (RPC kb_save_draft) — правки не
 * теряются и видны с другого устройства (боль брифа: в Платруме они жили в
 * браузере). Сохраняет через ~1 с после паузы в наборе, по одному запросу
 * за раз; уход со страницы — дописывает. `expected` — метка черновика, с
 * которой открыли редактор: разошлась (сохранил кто-то ещё) — «conflict»,
 * дальше не пишем, чтобы не затереть чужие правки.
 */
export function useDraftAutosave(nodeId: string, expected: string | null) {
  const qc = useQueryClient();
  const [state, setState] = useState<AutosaveState>("idle");
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const token = useRef<string | null>(expected);
  const pendingDoc = useRef<unknown[] | null>(null);
  const lastSaved = useRef<string | null>(null);
  const inflight = useRef<Promise<void> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopped = useRef(false);

  const flush = useCallback(async (): Promise<boolean> => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (inflight.current) await inflight.current;
    const doc = pendingDoc.current;
    if (!doc || stopped.current) return !stopped.current;
    pendingDoc.current = null;
    const json = JSON.stringify(doc);
    if (json === lastSaved.current) {
      setState("saved");
      return true;
    }
    setState("saving");
    let ok = true;
    inflight.current = (async () => {
      const { data, error } = await supabase.rpc("kb_save_draft", {
        p_node: nodeId,
        p_content: doc,
        p_expected: token.current,
      });
      if (error) {
        ok = false;
        if (error.message.includes("kb_draft_conflict")) {
          stopped.current = true;
          setState("conflict");
        } else {
          // Сеть или сервер: правки остаются в очереди до следующей попытки.
          pendingDoc.current ??= doc;
          setState("error");
        }
        return;
      }
      token.current = data as string;
      lastSaved.current = json;
      setSavedAt(new Date());
      setState(pendingDoc.current ? "pending" : "saved");
      void qc.invalidateQueries({ queryKey: [KB_DRAFTS_KEY] });
    })();
    await inflight.current;
    inflight.current = null;
    if (pendingDoc.current && !stopped.current) return flush();
    return ok;
  }, [nodeId, qc]);

  const schedule = useCallback(
    (doc: unknown[]) => {
      if (stopped.current) return;
      pendingDoc.current = doc;
      setState("pending");
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), DELAY_MS);
    },
    [flush],
  );

  // Ошибка сети — повтор через 5 с.
  useEffect(() => {
    if (state !== "error") return;
    const t = setTimeout(() => void flush(), 5000);
    return () => clearTimeout(t);
  }, [state, flush]);

  // Ушли со страницы статьи — дописываем; закрывают вкладку с несохранённым —
  // браузер спросит.
  useEffect(() => {
    const onUnload = (e: BeforeUnloadEvent) => {
      if (pendingDoc.current || inflight.current) e.preventDefault();
    };
    window.addEventListener("beforeunload", onUnload);
    return () => {
      window.removeEventListener("beforeunload", onUnload);
      if (pendingDoc.current) void flush();
    };
  }, [flush]);

  /** Документ, каким его открыли: без правок сохранять нечего. */
  const setBaseline = useCallback((doc: unknown[]) => {
    lastSaved.current = JSON.stringify(doc);
  }, []);

  return { state, savedAt, schedule, flush, setBaseline };
}
