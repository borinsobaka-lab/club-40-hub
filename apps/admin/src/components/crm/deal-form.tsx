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
import { useStaffProfile } from "@/hooks/use-staff-profile";
import { createDeal, crmErrorText, invalidateCrm } from "@/lib/crm/data";
import { parseBudget, parseTags } from "@/lib/crm/logic";
import type { CrmStage } from "@/lib/crm/types";
import { PersonSelect, StageSelect, StudioPick } from "./parts";

const TIPS = {
  budget: "Ожидаемая сумма продажи. По ней считается сумма этапа в воронке.",
  source: "Откуда пришёл человек: Instagram, сайт, рекомендация. Свободный текст.",
  tags: "Через запятую. По тегам сделки ищутся в воронке.",
};

/**
 * Новая сделка — содержимое окна (внутри DialogContent с key). Контакт
 * заводится вместе со сделкой; телефон или почта совпали с карточкой клиента
 * портала — база сама привяжет контакт к ней.
 */
export function DealForm({
  pipelineId,
  stages,
  stageId,
  studios,
  defaultStudioId,
  onDone,
}: {
  pipelineId: string;
  /** Этапы этой воронки, по порядку. */
  stages: CrmStage[];
  /** Этап по умолчанию («+» в колонке); иначе первый. */
  stageId?: string;
  studios: { id: string; name: string }[];
  defaultStudioId: string | null;
  onDone: (dealId: string) => void;
}) {
  const qc = useQueryClient();
  const { ensure } = useStaffProfile();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [title, setTitle] = useState("");
  const [stage, setStage] = useState(stageId ?? stages[0]?.id ?? "");
  const [studio, setStudio] = useState<string | null>(defaultStudioId);
  const [responsible, setResponsible] = useState<string | null | undefined>(undefined);
  const [budget, setBudget] = useState("");
  const [source, setSource] = useState("");
  const [tags, setTags] = useState("");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const contactName = name.trim();
    const dealTitle = title.trim() || contactName;
    if (!dealTitle) {
      toast.error("Укажите имя контакта или название сделки");
      return;
    }
    const amount = parseBudget(budget);
    if (amount === undefined) {
      toast.error("Бюджет — неотрицательное число");
      return;
    }
    setSaving(true);
    try {
      const me = await ensure();
      const id = await createDeal({
        title: dealTitle,
        pipeline_id: pipelineId,
        stage_id: stage,
        studio_id: studio,
        // Не трогали поле — ответственный тот, кто создаёт.
        responsible_id: responsible === undefined ? (me?.id ?? null) : responsible,
        budget: amount,
        source: source.trim() || null,
        tags: parseTags(tags),
        contact: contactName
          ? { name: contactName, phone: phone.trim() || null, email: email.trim() || null }
          : null,
      });
      await invalidateCrm(qc);
      toast.success("Сделка создана");
      onDone(id);
    } catch (e) {
      toast.error(crmErrorText(e, "Не удалось создать сделку"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Новая сделка</DialogTitle>
        <DialogDescription>Контакт и сделка заводятся вместе.</DialogDescription>
      </DialogHeader>
      <DialogForm onSubmit={() => void save()}>
        <DialogBody>
          <div className="space-y-4">
            <FormField label="Имя контакта" hint="Без названия сделка называется именем контакта.">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Анна"
                autoFocus
              />
            </FormField>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <FormField label="Телефон">
                <Input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  inputMode="tel"
                  placeholder="+995 555 12 34 56"
                />
              </FormField>
              <FormField label="Почта">
                <Input value={email} onChange={(e) => setEmail(e.target.value)} inputMode="email" />
              </FormField>
            </div>
            <FormField label="Название сделки">
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={name.trim() || "Абонемент на 8 занятий"}
              />
            </FormField>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <FormField label="Этап">
                <StageSelect stages={stages} value={stage} onChange={setStage} />
              </FormField>
              <FormField label="Клуб">
                <StudioPick value={studio} onChange={setStudio} studios={studios} />
              </FormField>
              <FormField label="Ответственный">
                <PersonSelect
                  value={responsible === undefined ? null : responsible}
                  onChange={setResponsible}
                  noneLabel={responsible === undefined ? "Я" : "Не назначен"}
                />
              </FormField>
              <FormField label="Бюджет, ₾" tip={TIPS.budget}>
                <Input
                  value={budget}
                  onChange={(e) => setBudget(e.target.value)}
                  inputMode="decimal"
                />
              </FormField>
              <FormField label="Источник" tip={TIPS.source}>
                <Input
                  value={source}
                  onChange={(e) => setSource(e.target.value)}
                  placeholder="Instagram"
                />
              </FormField>
              <FormField label="Теги" tip={TIPS.tags}>
                <Input
                  value={tags}
                  onChange={(e) => setTags(e.target.value)}
                  placeholder="пробное, акция"
                />
              </FormField>
            </div>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button type="submit" disabled={saving}>
            {saving && <Loader2 className="animate-spin" />}
            Создать
          </Button>
        </DialogFooter>
      </DialogForm>
    </>
  );
}
