import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  DialogBody,
  DialogDescription,
  DialogFooter,
  DialogForm,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { KB_TEMPLATES_KEY, kbErrorText, useKbTemplates } from "@/lib/kb/data";

const NEW = "__new__";

/**
 * «Сохранить как шаблон» (№32): текст статьи (с неопубликованными правками,
 * если они есть) — новым шаблоном базы или поверх существующего. Править
 * шаблон — так же: создать статью по нему, поправить, сохранить поверх.
 */
export function KbSaveTemplateForm({
  baseId,
  content,
  defaultTitle,
  onDone,
}: {
  baseId: string;
  content: unknown[];
  defaultTitle: string;
  onDone: () => void;
}) {
  const qc = useQueryClient();
  const { data: templates } = useKbTemplates(baseId);
  const [target, setTarget] = useState(NEW);
  const [title, setTitle] = useState(defaultTitle);
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const replacing = templates?.find((t) => t.id === target);

  const pickTarget = (value: string) => {
    setTarget(value);
    const t = templates?.find((x) => x.id === value);
    setTitle(t ? t.title : defaultTitle);
    setDescription(t ? t.description : "");
  };

  const save = async () => {
    const t = title.trim();
    if (!t) {
      toast.error("Укажите название шаблона");
      return;
    }
    setSaving(true);
    try {
      const row = { title: t, description: description.trim(), content };
      const { error } = replacing
        ? await supabase.from("kb_templates").update(row).eq("id", replacing.id)
        : await supabase.from("kb_templates").insert({ ...row, base_id: baseId });
      if (error) {
        toast.error(kbErrorText(error.message));
        return;
      }
      await qc.invalidateQueries({ queryKey: [KB_TEMPLATES_KEY] });
      toast.success(replacing ? "Шаблон обновлён" : "Шаблон сохранён");
      onDone();
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Сохранить как шаблон</DialogTitle>
        <DialogDescription>
          Новую статью можно будет начать с этого текста: «Статья» → «Шаблон». Сама статья не
          меняется.
        </DialogDescription>
      </DialogHeader>
      <DialogForm onSubmit={save}>
        <DialogBody>
          <div className="space-y-4">
            {!!templates?.length && (
              <FormField
                label="Куда сохранить"
                tip="Новым шаблоном или поверх существующего — так шаблон обновляют."
              >
                <Select value={target} onValueChange={pickTarget}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NEW}>Новый шаблон</SelectItem>
                    {templates.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        Заменить «{t.title}»
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
            )}
            <FormField label="Название шаблона" required>
              <Input
                autoFocus
                value={title}
                maxLength={120}
                onChange={(e) => setTitle(e.target.value)}
              />
            </FormField>
            <FormField label="Описание" tip="Когда брать этот шаблон — видно при создании статьи.">
              <Textarea
                value={description}
                maxLength={300}
                rows={2}
                onChange={(e) => setDescription(e.target.value)}
              />
            </FormField>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onDone} disabled={saving}>
            Отмена
          </Button>
          <Button type="submit" disabled={saving}>
            {saving && <Loader2 className="animate-spin" />}
            {replacing ? "Заменить" : "Сохранить"}
          </Button>
        </DialogFooter>
      </DialogForm>
    </>
  );
}
