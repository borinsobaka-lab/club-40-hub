import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DialogBody,
  DialogDescription,
  DialogFooter,
  DialogForm,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FormField, SwitchRow } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { invalidateAcademy } from "@/lib/academy/data";
import {
  acadError,
  newOption,
  QUESTION_KIND_HINT,
  QUESTION_KIND_LABEL,
  questionError,
} from "@/lib/academy/logic";
import type { AcadOption, AcadQuestion, AcadQuestionKind } from "@/lib/academy/types";
import { cn } from "@/lib/utils";

const TIPS = {
  points: "Сколько баллов даёт верный ответ. Результат теста — доля набранных баллов.",
  explanation:
    "Ученик увидит пояснение у вопроса, где ошибся: где в уроке найти ответ. Правильный вариант сам по себе ученику не показывается.",
  file: "Ученик сможет приложить к ответу файл — фото, видео, документ (до 50 МБ).",
};

/**
 * Вопрос теста (право «Создаёт курсы»): закрытый с одним или несколькими
 * верными вариантами или свободный — его проверяет проверяющий. Те же
 * правила проверяет база (acad_questions_biu).
 */
export function AcadQuestionForm({
  stepId,
  question,
  onDone,
}: {
  stepId: string;
  question: AcadQuestion | null;
  onDone: () => void;
}) {
  const qc = useQueryClient();
  const [kind, setKind] = useState<AcadQuestionKind>(question?.kind ?? "single");
  const [text, setText] = useState(question?.text ?? "");
  const [options, setOptions] = useState<AcadOption[]>(
    question?.options.length ? question.options : [newOption(), newOption()],
  );
  const [points, setPoints] = useState(String(question?.points ?? 1));
  const [explanation, setExplanation] = useState(question?.explanation ?? "");
  const [allowFile, setAllowFile] = useState(question?.allow_file ?? false);
  const [saving, setSaving] = useState(false);
  const [showError, setShowError] = useState(false);

  const error = questionError({ kind, text, options });
  const setOption = (id: string, patch: Partial<AcadOption>) =>
    setOptions((list) =>
      list.map((o) =>
        o.id === id
          ? { ...o, ...patch }
          : // Один верный — отметка у другого снимается.
            patch.correct && kind === "single"
            ? { ...o, correct: false }
            : o,
      ),
    );
  const changeKind = (k: AcadQuestionKind) => {
    setKind(k);
    // Из «нескольких» в «один» — оставляем первый верный.
    if (k === "single") {
      const first = options.find((o) => o.correct)?.id;
      setOptions((list) => list.map((o) => ({ ...o, correct: o.id === first })));
    }
  };

  const save = async () => {
    const p = Number(points);
    if (error) {
      setShowError(true);
      toast.error(error);
      return;
    }
    if (!Number.isInteger(p) || p < 1 || p > 100) {
      toast.error("Баллы — от 1 до 100");
      return;
    }
    setSaving(true);
    try {
      const row = {
        step_id: stepId,
        kind,
        text: text.trim(),
        options: kind === "open" ? [] : options.map((o) => ({ ...o, text: o.text.trim() })),
        points: p,
        explanation: explanation.trim(),
        allow_file: kind === "open" && allowFile,
      };
      const { error: err } = question
        ? await supabase.from("acad_questions").update(row).eq("id", question.id)
        : await supabase.from("acad_questions").insert(row);
      if (err) throw new Error(err.message);
      await invalidateAcademy(qc);
      onDone();
    } catch (e) {
      toast.error(acadError(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{question ? "Вопрос" : "Новый вопрос"}</DialogTitle>
        <DialogDescription>{QUESTION_KIND_HINT[kind]}</DialogDescription>
      </DialogHeader>
      <DialogForm onSubmit={save}>
        <DialogBody>
          <div className="space-y-4">
            <SegmentedControl
              aria-label="Вид вопроса"
              fullWidth
              value={kind}
              onChange={changeKind}
              options={(["single", "multiple", "open"] as const).map((k) => ({
                value: k,
                label: QUESTION_KIND_LABEL[k],
              }))}
            />
            <FormField label="Вопрос" required>
              <Textarea
                autoFocus
                rows={3}
                maxLength={2000}
                value={text}
                placeholder="Например, «Во сколько администратор открывает кассу?»"
                onChange={(e) => setText(e.target.value)}
              />
            </FormField>
            {kind !== "open" && (
              <FormField
                label={
                  kind === "single"
                    ? "Варианты — отметьте верный"
                    : "Варианты — отметьте все верные"
                }
                required
                htmlFor={null}
                error={showError && error && !error.startsWith("Напишите") ? error : undefined}
              >
                <div className="space-y-2">
                  {options.map((o, i) => (
                    <div
                      key={o.id}
                      className={cn(
                        "flex items-center gap-2 rounded-md border px-2 py-1",
                        o.correct && "border-emerald-300 bg-emerald-50",
                      )}
                    >
                      <Checkbox
                        aria-label={`Вариант ${i + 1} верный`}
                        checked={o.correct}
                        className={cn(kind === "single" && "rounded-full")}
                        onCheckedChange={(v) => setOption(o.id, { correct: v === true })}
                      />
                      <Input
                        value={o.text}
                        maxLength={500}
                        placeholder={`Вариант ${i + 1}`}
                        className="border-0 bg-transparent shadow-none focus-visible:ring-0"
                        onChange={(e) => setOption(o.id, { text: e.target.value })}
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Удалить вариант"
                        disabled={options.length <= 2}
                        onClick={() => setOptions((list) => list.filter((x) => x.id !== o.id))}
                      >
                        <X />
                      </Button>
                    </div>
                  ))}
                  {options.length < 20 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setOptions((list) => [...list, newOption()])}
                    >
                      <Plus /> Вариант
                    </Button>
                  )}
                </div>
              </FormField>
            )}
            {kind === "open" && (
              <SwitchRow
                title="Можно приложить файл"
                tip={TIPS.file}
                checked={allowFile}
                onCheckedChange={setAllowFile}
              />
            )}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[8rem_1fr]">
              <FormField label="Баллы" tip={TIPS.points}>
                <Input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={100}
                  value={points}
                  onChange={(e) => setPoints(e.target.value)}
                />
              </FormField>
              <FormField label="Пояснение при ошибке" tip={TIPS.explanation} optional>
                <Textarea
                  rows={2}
                  maxLength={2000}
                  value={explanation}
                  placeholder="Где в уроке найти ответ"
                  onChange={(e) => setExplanation(e.target.value)}
                />
              </FormField>
            </div>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onDone} disabled={saving}>
            Отмена
          </Button>
          <Button type="submit" disabled={saving}>
            {saving && <Loader2 className="animate-spin" />}
            {question ? "Сохранить" : "Добавить"}
          </Button>
        </DialogFooter>
      </DialogForm>
    </>
  );
}
