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
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";

export type ActiveMembership = {
  id: string;
  ends_at: string | null;
  visits_left: number | null;
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

  useEffect(() => {
    if (!open || !membership) return;
    setEndsAt(membership.ends_at ?? "");
    setUnlimitedVisits(membership.visits_left == null);
    setVisitsLeft(membership.visits_left != null ? String(membership.visits_left) : "");
  }, [open, membership]);

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
        </div>
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
