import { useEffect, useState } from "react";
import { Bell, BellOff } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { disableNotify, enableNotify, notifyState, type NotifyState } from "@/lib/crm/notify";

/**
 * «Уведомления» — пуши CRM на этом браузере: срок задачи, клиент ждёт ответа
 * дольше норматива, назначена сделка. Включается на каждом браузере отдельно.
 * Там, где браузер пуши не умеет (или service worker не запущен), кнопки нет.
 */
export function CrmNotifyButton() {
  const [state, setState] = useState<NotifyState | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    void notifyState()
      .then((s) => alive && setState(s))
      .catch(() => alive && setState("unsupported"));
    return () => {
      alive = false;
    };
  }, []);

  if (!state || state === "unsupported") return null;

  const toggle = async () => {
    setBusy(true);
    try {
      const next = state === "on" ? await disableNotify() : await enableNotify();
      setState(next);
      if (next === "on")
        toast.success("Уведомления включены", {
          description: "Срок задачи, клиент ждёт ответа, назначена сделка — на этом устройстве.",
        });
      else if (next === "denied")
        toast.error("Уведомления запрещены в настройках браузера", {
          description: "Разрешите их для этого сайта (значок слева от адреса) и нажмите ещё раз.",
        });
      else if (state === "on") toast.info("Уведомления выключены на этом устройстве");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось включить уведомления");
    } finally {
      setBusy(false);
    }
  };

  const on = state === "on";
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={busy}
      onClick={() => void toggle()}
      title={
        on
          ? "Уведомления CRM включены на этом устройстве — нажмите, чтобы выключить"
          : "Получать уведомления: срок задачи, клиент ждёт ответа, назначена сделка"
      }
    >
      {on ? <Bell className="text-emerald-600" /> : <BellOff />}
      {on ? "Уведомления включены" : "Включить уведомления"}
    </Button>
  );
}
