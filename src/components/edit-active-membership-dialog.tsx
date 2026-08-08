import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogBody,
  DialogFooter,
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

export function EditActiveMembershipDialog({
  open,
  onOpenChange,
  membership,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  membership: ActiveMembership | null;
  onSaved: () => void;
}) {
  const [endsAt, setEndsAt] = useState("");
  const [unlimitedVisits, setUnlimitedVisits] = useState(false);
  const [visitsLeft, setVisitsLeft] = useState("");
  const [saving, setSaving] = useState(false);
  const [freezeDaysInput, setFreezeDaysInput] = useState("");
  const [freezing, setFreezing] = useState(false);

  useEffect(() => {
    if (!open || !membership) return;
    setEndsAt(membership.ends_at ?? "");
    setUnlimitedVisits(membership.visits_left == null);
    setVisitsLeft(membership.visits_left != null ? String(membership.visits_left) : "");
    setFreezeDaysInput("");
  }, [open, membership]);

  const allowed = membership?.freeze_days_allowed ?? 0;
  const used = membership?.freeze_days_used ?? 0;
  const remaining = Math.max(0, allowed - used);
  const status = membership?.status;

  const handleFreeze = async () => {
    if (!membership) return;
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
    const { error } = await supabase.rpc("freeze_membership", {
      _client_membership_id: membership.id,
      _days: days,
      _reason: null,
    });
    setFreezing(false);
    if (error) {
      toast.error("Ошибка заморозки: " + error.message);
      return;
    }
    toast.success("Абонемент заморожен");
    onOpenChange(false);
    onSaved();
  };

  const handleUnfreeze = async () => {
    if (!membership) return;
    setFreezing(true);
    const { error } = await supabase.rpc("unfreeze_membership", {
      _client_membership_id: membership.id,
    });
    setFreezing(false);
    if (error) {
      toast.error("Ошибка разморозки: " + error.message);
      return;
    }
    toast.success("Абонемент разморожен");
    onOpenChange(false);
    onSaved();
  };

  const handleSave = async () => {
    if (!membership) return;
    setSaving(true);
    const { error } = await supabase
      .from("client_memberships")
      .update({
        ends_at: endsAt || null,
        visits_left: unlimitedVisits ? null : visitsLeft ? Number(visitsLeft) : null,
      })
      .eq("id", membership.id);
    setSaving(false);
    if (error) {
      toast.error("Ошибка сохранения: " + error.message);
      return;
    }
    toast.success("Абонемент обновлён");
    onOpenChange(false);
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Редактировать активный абонемент</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="cm-ends">Действует до</Label>
              <Input
                id="cm-ends"
                type="date"
                value={endsAt}
                onChange={(e) => setEndsAt(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Осталось посещений</Label>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min={0}
                  value={visitsLeft}
                  onChange={(e) => setVisitsLeft(e.target.value)}
                  disabled={unlimitedVisits}
                  placeholder="Например, 5"
                  className="flex-1"
                />
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={unlimitedVisits}
                    onCheckedChange={(v) => setUnlimitedVisits(!!v)}
                  />
                  Безлимит
                </label>
              </div>
            </div>

            {/* Блок показываем и при нулевой квоте, если абонемент уже заморожен:
              иначе после обнуления «дней заморозки» в тарифе разморозить его
              стало бы нечем. */}
            {(allowed > 0 || status === "frozen") && (
              <div className="space-y-2 rounded-md border bg-muted/30 p-3">
                <div className="text-sm font-medium">Заморозка</div>
                <div className="text-xs text-muted-foreground">
                  Доступно {remaining} из {allowed} дн.
                  {status === "frozen" && membership?.frozen_until
                    ? ` · заморожен до ${formatDate(membership.frozen_until)}`
                    : ""}
                </div>
                {status === "frozen" ? (
                  <Button variant="outline" size="sm" onClick={handleUnfreeze} disabled={freezing}>
                    {freezing && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
                    Разморозить
                  </Button>
                ) : status === "active" || status === undefined ? (
                  <div className="flex items-end gap-2">
                    <div className="flex-1 space-y-1">
                      <Label htmlFor="cm-freeze">Дней</Label>
                      <Input
                        id="cm-freeze"
                        type="number"
                        min={1}
                        max={remaining}
                        value={freezeDaysInput}
                        onChange={(e) => setFreezeDaysInput(e.target.value)}
                        placeholder={String(remaining)}
                        disabled={remaining <= 0}
                      />
                    </div>
                    <Button size="sm" onClick={handleFreeze} disabled={freezing || remaining <= 0}>
                      {freezing && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
                      Заморозить
                    </Button>
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Отмена
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            Сохранить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
