import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";

// Студия текущего клиента (clients.studio_id).
//
// Зачем: расписание, новости и услуги должны показывать данные студии клиента,
// а не всех студий сразу — с открытием второй точки нефильтрованные запросы
// начали бы смешивать контент. Паттерн тот же, что уже используется в
// memberships.tsx (там студия берётся из загруженной карточки клиента).
//
// studioId === null при studioReady === true означает «гость или клиент без
// карточки» — в этом случае страницы оставляют запросы нефильтрованными,
// то есть поведение при одной студии не меняется.
//
// Кэш на модуль: значение стабильно в рамках сессии, перезапрашивается только
// при смене пользователя.

type State = { studioId: string | null; studioReady: boolean };

let cacheUserId: string | null = null;
let cacheStudioId: string | null = null;
// Запрос в полёте храним вместе с пользователем, для которого он начат:
// раньше промис был общий на модуль, и при смене сессии (выход/вход или
// обновление токена) второй вызов переиспользовал чужой запрос — новый клиент
// получал студию предыдущего и до конца сессии смотрел его расписание.
let inflight: { userId: string; promise: Promise<string | null> } | null = null;

async function fetchStudioId(userId: string): Promise<string | null> {
  const { data } = await supabase
    .from("clients")
    .select("studio_id")
    .eq("user_id", userId)
    .maybeSingle();
  return data?.studio_id ?? null;
}

export function useClientStudioId(): State {
  const { user, loading } = useAuth();
  const [state, setState] = useState<State>(() =>
    user && cacheUserId === user.id
      ? { studioId: cacheStudioId, studioReady: true }
      : { studioId: null, studioReady: false },
  );

  useEffect(() => {
    if (loading) return;
    if (!user) {
      setState({ studioId: null, studioReady: true });
      return;
    }
    if (cacheUserId === user.id) {
      setState({ studioId: cacheStudioId, studioReady: true });
      return;
    }
    const userId = user.id;
    let cancelled = false;
    if (!inflight || inflight.userId !== userId) {
      inflight = { userId, promise: fetchStudioId(userId) };
    }
    const current = inflight;
    current.promise
      .then((sid) => {
        cacheUserId = userId;
        cacheStudioId = sid;
        if (!cancelled) setState({ studioId: sid, studioReady: true });
      })
      .catch(() => {
        // Не оставляем приложение в вечном скелетоне: без карточки клиента
        // страницы просто не фильтруют по студии — как для гостя.
        if (!cancelled) setState({ studioId: null, studioReady: true });
      })
      .finally(() => {
        if (inflight === current) inflight = null;
      });
    return () => {
      cancelled = true;
    };
  }, [user, loading]);

  return state;
}
