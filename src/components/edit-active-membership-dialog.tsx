import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CheckboxField, Field, FieldGroup } from "@/components/ui/field";
import {
  Dialog,
  DialogContent,
  DialogBody,
  DialogFooter,
  DialogForm,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { formatDate } from "@/lib/format";

export type ActiveMembership = {
  id: string;
  ends_at: string | null;
  visits_left: number | null;
  status?: string;
  freeze_days_used?: number | null;
  frozen_until?: string | null;
  freeze_days_allowed?: number;
};

type FormProps = {
  onOpenChange: (v: boolean) => void;
  membership: ActiveMembership;
  onSaved: () => void;
};

export function EditActiveMembershipDialog({
  open,
  onOpenChange,
  membership,
  onSaved,
}: Omit<FormProps, "membership"> & {
  open: boolean;
  membership: ActiveMembership | null;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        {/*
          Форма монтируется заново при каждом открытии — сбрасывать её не нужно,
          а перезагрузка карточки под открытым окном не затирает ввод.
        */}
        {membership && (
          <MembershipForm
            key={membership.id}
            membership={membership}
            onOpenChange={onOpenChange}
            onSaved={onSaved}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function MembershipForm({ onOpenChange, membership, onSaved }: FormProps) {
  const [endsAt, setEndsAt] = useState(membership.ends_at ?? "");
  const [unlimitedVisits, setUnlimitedVisits] = useState(membership.visits_left == null);
  const [visitsLeft, setVisitsLeft] = useState(
    membership.visits_left != null ? String(membership.visits_left) : "",
  );
  const [saving, setSaving] = useState(false);
  const [freezeDaysInput, setFreezeDaysInput] = useState("");
  const [freezing, setFreezing] = useState(false);

  const allowed = membership.freeze_days_allowed ?? 0;
  const used = membership.freeze_days_used ?? 0;
  const remaining = Math.max(0, allowed - used);
  const status = membership.status;

  const done = (message: string) => {
    toast.success(message);
    onOpenChange(false);
    onSaved();
  };

  const handleFreeze = async () => {
    const days = Math.floor(Number(freezeDaysInput) || 0);
    if (days <= 0) {
      toast.error("Укажите количество дней");
      return;
    }
    if (days > remaining) {
      toast.error(`Доступно только ${remaining} дн. заморозки`);
      return;
    }
    setFreezing(true);
    try {
      const { error } = await supabase.rpc("freeze_membership", {
        _client_membership_id: membership.id,
        _days: days,
        _reason: null,
      });
      if (error) {
        toast.error("Ошибка заморозки: " + error.message);
        return;
      }
      done("Абонемент заморожен");
    } finally {
      setFreezing(false);
    }
  };

  const handleUnfreeze = async () => {
    setFreezing(true);
    try {
      const { error } = await supabase.rpc("unfreeze_membership", {
        _client_membership_id: membership.id,
      });
      if (error) {
        toast.error("Ошибка разморозки: " + error.message);
        return;
      }
      done("Абонемент разморожен");
    } finally {
      setFreezing(false);
    }
  };

  const handleSave = async () => {
    // null в visits_left — это безлимит. Пустое поле при снятой галочке
    // раньше молча превращало абонемент в безлимитный.
    let visits: number | null = null;
    if (!unlimitedVisits) {
      const n = Number(visitsLeft.trim());
      if (visitsLeft.trim() === "" || !Number.isInteger(n) || n < 0) {
        toast.error("Укажите количество посещений (целое число от 0) или отметьте «Безлимит»");
        return;
      }
      visits = n;
    }
    setSaving(true);
    try {
      const { error } = await supabase
        .from("client_memberships")
        .update({
          ends_at: endsAt || null,
          visits_left: visits,
        })
        .eq("id", membership.id);
      if (error) {
        toast.error("Ошибка сохранения: " + error.message);
        return;
      }
      done("Абонемент обновлён");
    } finally {
      setSaving(false);
    }
  };

  return (
    <DialogForm onSubmit={handleSave}>
      <DialogHeader>
        <DialogTitle>Редактировать активный абонемент</DialogTitle>
      </DialogHeader>
      <DialogBody>
        <div className="space-y-4">
          <Field label="Действует до">
            <Input type="date" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
          </Field>
          <Field label="Осталось посещений">
            <div className="flex items-center gap-4">
              <Input
                inputMode="numeric"
                value={visitsLeft}
                onChange={(e) => setVisitsLeft(e.target.value.replace(/[^0-9]/g, ""))}
                disabled={unlimitedVisits}
                placeholder="Например, 5"
                className="flex-1"
              />
              <CheckboxField
                label="Безлимит"
                checked={unlimitedVisits}
                onCheckedChange={setUnlimitedVisits}
                className="shrink-0"
              />
            </div>
          </Field>

          {/* Блок показываем и при нулевой квоте, если абонемент уже заморожен:
            иначе после обнуления «дней заморозки» в тарифе разморозить его
            стало бы нечем. */}
          {(allowed > 0 || status === "frozen") && (
            <FieldGroup
              title="Заморозка"
              description={
                <>
                  Доступно {remaining} из {allowed} дн.
                  {status === "frozen" && membership.frozen_until
                    ? ` · заморожен до ${formatDate(membership.frozen_until)}`
                    : ""}
                </>
              }
            >
              {status === "frozen" ? (
                <Button variant="outline" onClick={handleUnfreeze} loading={freezing}>
                  Разморозить
                </Button>
              ) : status === "active" || status === undefined ? (
                <div className="flex items-end gap-2">
                  <Field label="Дней" className="flex-1">
                    <Input
                      inputMode="numeric"
                      value={freezeDaysInput}
                      onChange={(e) => setFreezeDaysInput(e.target.value.replace(/[^0-9]/g, ""))}
                      onKeyDown={(e) => {
                        // Enter здесь — «Заморозить», а не сохранение формы.
                        if (e.key === "Enter") {
                          e.preventDefault();
                          if (!freezing && remaining > 0) handleFreeze();
                        }
                      }}
                      placeholder={String(remaining)}
                      disabled={remaining <= 0}
                    />
                  </Field>
                  <Button
                    variant="outline"
                    onClick={handleFreeze}
                    loading={freezing}
                    disabled={remaining <= 0}
                  >
                    Заморозить
                  </Button>
                </div>
              ) : null}
            </FieldGroup>
          )}
        </div>
      </DialogBody>
      <DialogFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
          Отмена
        </Button>
        <Button type="submit" loading={saving}>
          Сохранить
        </Button>
      </DialogFooter>
    </DialogForm>
  );
}
