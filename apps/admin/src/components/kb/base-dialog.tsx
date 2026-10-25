import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { KB_BASES_KEY } from "@/lib/kb/data";
import { KB_DEFAULT_ICON, KB_ICONS } from "@/lib/kb/icons";
import type { KbBase } from "@/lib/kb/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FormField, SwitchRow } from "@/components/ui/form-field";
import {
  DialogBody,
  DialogDescription,
  DialogFooter,
  DialogForm,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const TIPS = {
  railTitle:
    "Подпись под иконкой в левой рейке: в строку помещается ~7 букв, длинное слово переносится на вторую строку.",
  showInRail:
    "База — отдельным пунктом в левой рейке. Выключено — база открывается из «Знаний» внизу рейки.",
  description: "Видно в списке баз знаний — для чего база и кому она.",
  protect:
    "Во всех статьях базы читатели не смогут скопировать текст, сохранить картинку и распечатать; поверх — водяной знак с почтой и датой. У отдельной статьи можно включить или выключить в её меню «⋯».",
};

/**
 * Новая база знаний или её настройки (только владелец; RLS — kb_is_admin).
 * Доступы сотрудникам выдаются в «Доступах», не здесь.
 */
export function KbBaseForm({ base, onDone }: { base: KbBase | null; onDone: () => void }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState(base?.title ?? "");
  const [railTitle, setRailTitle] = useState(base?.rail_title ?? "");
  const [icon, setIcon] = useState(base?.icon ?? KB_DEFAULT_ICON);
  const [description, setDescription] = useState(base?.description ?? "");
  const [showInRail, setShowInRail] = useState(base?.show_in_rail ?? true);
  const [protect, setProtect] = useState(base?.protect_content ?? false);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const t = title.trim();
    const r = (railTitle.trim() || t).slice(0, 16);
    if (!t) {
      toast.error("Укажите название базы");
      return;
    }
    setSaving(true);
    try {
      const row = {
        title: t,
        rail_title: r,
        icon,
        description: description.trim(),
        show_in_rail: showInRail,
        protect_content: protect,
      };
      const { error } = base
        ? await supabase.from("kb_bases").update(row).eq("id", base.id)
        : await supabase.from("kb_bases").insert(row);
      if (error) throw new Error(error.message);
      toast.success(base ? "База знаний сохранена" : "База знаний создана");
      await qc.invalidateQueries({ queryKey: [KB_BASES_KEY] });
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось сохранить");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{base ? "База знаний" : "Новая база знаний"}</DialogTitle>
        <DialogDescription>
          Название, иконка и место в рейке. Кто видит базу — настраивается в «Доступах»: по
          умолчанию её видят только владельцы.
        </DialogDescription>
      </DialogHeader>
      <DialogForm onSubmit={save}>
        <DialogBody>
          <div className="space-y-4">
            <FormField label="Название" required>
              <Input
                value={title}
                maxLength={80}
                placeholder="Например, «Стандарты Lady Stretch»"
                onChange={(e) => setTitle(e.target.value)}
              />
            </FormField>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <FormField label="Подпись в рейке" tip={TIPS.railTitle}>
                <Input
                  value={railTitle}
                  maxLength={16}
                  placeholder={title.trim().slice(0, 16) || "Стандарты"}
                  onChange={(e) => setRailTitle(e.target.value)}
                />
              </FormField>
              <FormField label="Иконка">
                <Select value={icon} onValueChange={setIcon}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {KB_ICONS.map((i) => (
                      <SelectItem key={i.key} value={i.key} textValue={i.label}>
                        <span className="flex items-center gap-2">
                          <i.icon className="size-4 text-muted-foreground" />
                          {i.label}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
            </div>
            <FormField label="Описание" tip={TIPS.description}>
              <Textarea
                value={description}
                maxLength={500}
                rows={3}
                onChange={(e) => setDescription(e.target.value)}
              />
            </FormField>
            <SwitchRow
              title="Показывать в рейке"
              tip={TIPS.showInRail}
              checked={showInRail}
              onCheckedChange={setShowInRail}
            />
            <SwitchRow
              title="Защита содержимого"
              tip={TIPS.protect}
              checked={protect}
              onCheckedChange={setProtect}
            />
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onDone} disabled={saving}>
            Отмена
          </Button>
          <Button type="submit" disabled={saving}>
            {saving && <Loader2 className="animate-spin" />}
            {base ? "Сохранить" : "Создать"}
          </Button>
        </DialogFooter>
      </DialogForm>
    </>
  );
}
