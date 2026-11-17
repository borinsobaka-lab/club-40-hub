import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Code, Copy, Loader2, Pencil, Plus, QrCode, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { useConfirm } from "@/components/confirm-dialog";
import { Panel } from "@/components/crm/channels-settings";
import { StageDot, StageSelect } from "@/components/crm/parts";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogForm,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FormField, InfoNote, SwitchRow } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  crmAdSpendQuery,
  crmErrorText,
  crmLeadFormsQuery,
  crmLinksQuery,
  crmScenariosQuery,
  crmSettingsQuery,
  crmSetupQuery,
  crmSourceNamesQuery,
  deleteAdSpend,
  deleteLeadForm,
  deleteLink,
  invalidateCrm,
  previewScenario,
  saveAdSpend,
  saveCrmSettings,
  saveLeadForm,
  saveLink,
  saveScenario,
  useCrmStudios,
  useLinkDeals,
  type CrmAdSpend,
  type CrmLeadForm,
  type CrmLink,
  type CrmScenario,
} from "@/lib/crm/data";
import { leadFormSnippet, leadFormUrl, linkPublicUrl, linkRedirectUrl } from "@/lib/crm/leads";
import {
  DEFAULT_CRM_SETTINGS,
  monthLabel,
  monthOf,
  NONE,
  plural,
  SCENARIOS,
  scenarioRule,
} from "@/lib/crm/logic";
import { formatMoney, todayISO } from "@/lib/format";

const TIPS = {
  sla: "За сколько минут сотрудник должен ответить клиенту. Дольше — диалог подсвечивается, ответственному сделки приходит уведомление. Считается рабочее время.",
  escalate:
    "Если клиенту не ответили и за это время — уведомление получают сотрудники с правом «CRM: настройка». Пусто — не сообщать.",
  hours:
    "Часы по Тбилиси, когда клиентам отвечают. Сообщение, пришедшее ночью, начинает «ждать» с открытия — в отчёт и уведомления ночь не идёт.",
  formSource: "Как сделки с этой формы называются в отчёте «Источники». Пусто — название формы.",
  formStudio:
    "Клуб, которому достаются заявки. «По распределению» — клуб и ответственный из «Распределения новых заявок».",
  linkSource: "Источник сделки в отчёте: «Листовки», «Блогеры», «Реклама Instagram».",
  linkCampaign: "Необязательно: кампания или место — «Ваке, ноябрь». По ней отдельный срез отчёта.",
  linkText:
    "С этим текстом у клиента откроется WhatsApp. В конец добавится код ссылки — по нему заявка свяжется с источником, стирать его не нужно.",
  spendSource: "Тот же источник, что у сделок, — по названию расход сопоставляется с заявками.",
};

const copy = (text: string, done = "Скопировано") =>
  navigator.clipboard.writeText(text).then(
    () => toast.success(done),
    () => toast.error("Не удалось скопировать"),
  );

const numberOrNull = (raw: string): number | null => {
  const n = Number(raw.replace(",", ".").trim());
  return raw.trim() !== "" && Number.isFinite(n) ? n : null;
};

// Скорость ответа ---------------------------------------------------------------

/** «Скорость ответа»: норматив, эскалация руководителю, рабочие часы. */
export function ReplySlaPanel() {
  const { data } = useQuery(crmSettingsQuery);
  return (
    <Panel title="Скорость ответа клиентам">
      {data ? <ReplySlaForm key={JSON.stringify(data)} initial={data} /> : null}
    </Panel>
  );
}

function ReplySlaForm({ initial }: { initial: typeof DEFAULT_CRM_SETTINGS }) {
  const qc = useQueryClient();
  const [sla, setSla] = useState(String(initial.reply_sla_minutes));
  const [escalate, setEscalate] = useState(
    initial.escalate_minutes === null ? "" : String(initial.escalate_minutes),
  );
  const [from, setFrom] = useState(String(initial.work_from));
  const [to, setTo] = useState(String(initial.work_to));
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const slaN = numberOrNull(sla);
    const escN = numberOrNull(escalate);
    const fromN = numberOrNull(from);
    const toN = numberOrNull(to);
    if (!slaN || slaN < 1 || slaN > 1440) return void toast.error("Норматив — от 1 до 1440 минут");
    if (escN !== null && escN <= slaN)
      return void toast.error("Руководителю сообщаем позже норматива — укажите больше минут");
    if (fromN === null || toN === null || fromN < 0 || toN > 24 || fromN >= toN)
      return void toast.error("Рабочие часы: начало раньше конца, от 0 до 24");
    setSaving(true);
    try {
      await saveCrmSettings({
        reply_sla_minutes: Math.round(slaN),
        escalate_minutes: escN === null ? null : Math.round(escN),
        work_from: Math.round(fromN),
        work_to: Math.round(toN),
      });
      await invalidateCrm(qc);
      toast.success("Сохранено");
    } catch (e) {
      toast.error(crmErrorText(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4 p-3">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <FormField label="Ответить за, минут" tip={TIPS.sla} required>
          <Input inputMode="numeric" value={sla} onChange={(e) => setSla(e.target.value)} />
        </FormField>
        <FormField label="Руководителю — через, минут" tip={TIPS.escalate}>
          <Input
            inputMode="numeric"
            value={escalate}
            placeholder="не сообщать"
            onChange={(e) => setEscalate(e.target.value)}
          />
        </FormField>
        <FormField label="Работаем с, час" tip={TIPS.hours} required>
          <Input inputMode="numeric" value={from} onChange={(e) => setFrom(e.target.value)} />
        </FormField>
        <FormField label="до, час" required>
          <Input inputMode="numeric" value={to} onChange={(e) => setTo(e.target.value)} />
        </FormField>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" disabled={saving} onClick={() => void save()}>
          {saving && <Loader2 className="animate-spin" />}
          Сохранить
        </Button>
        <p className="min-w-0 flex-1 text-xs text-muted-foreground">
          Уведомления приходят в браузер тем, кто включил их кнопкой «Включить уведомления» в
          «Диалогах» или «Задачах»: срок задачи, клиент ждёт дольше норматива, назначена сделка.
        </p>
      </div>
    </div>
  );
}

// Сценарии -----------------------------------------------------------------------

/**
 * «Сценарии» — сделки по клиентам клуба из событий портала: продление,
 * после пробного, давно не был, возврат, долг. Проверка — раз в 10 минут.
 */
export function ScenariosPanel() {
  const qc = useQueryClient();
  const { data: scenarios = [] } = useQuery(crmScenariosQuery);
  const { data: setup } = useQuery(crmSetupQuery);
  const { confirm, confirmDialog } = useConfirm();
  const [editing, setEditing] = useState<CrmScenario | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const toggle = async (sc: CrmScenario, enabled: boolean) => {
    setBusy(sc.key);
    try {
      if (enabled) {
        if (!sc.stage_id) {
          setEditing(sc);
          return;
        }
        const n = await previewScenario(sc.key, sc.params);
        const ok = await confirm({
          title: `Включить сценарий «${SCENARIOS[sc.key].label}»?`,
          description:
            n > 0
              ? `Сейчас под него подходит ${n} ${plural(n, "клиент", "клиента", "клиентов")} — по ним в течение 10 минут появятся сделки с задачей ответственному (не больше 200 за проход). Дальше сделки заводятся сами, по мере появления таких клиентов.`
              : "Сейчас подходящих клиентов нет. Сделки будут заводиться сами, когда такие клиенты появятся.",
          confirmLabel: "Включить",
        });
        if (!ok) return;
      }
      await saveScenario(sc.key, { enabled });
      await invalidateCrm(qc);
    } catch (e) {
      toast.error(crmErrorText(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Panel title="Сценарии по клиентам клуба">
      <p className="border-b px-3 py-3 text-sm text-muted-foreground">
        Сценарий сам заводит сделку и задачу ответственному, когда клиенту пора позвонить или
        написать. Ответственный — по очереди из «Распределения новых заявок» клуба абонемента.
        Пока по клиенту открыта сделка сценария, вторая не заводится.
      </p>
      <ul className="divide-y">
        {scenarios.map((sc) => {
          const stage = setup?.stages.find((s) => s.id === sc.stage_id);
          const pipeline = setup?.pipelines.find((p) => p.id === stage?.pipeline_id);
          return (
            <li key={sc.key} className="flex items-start gap-3 px-3 py-3">
              <Switch
                className="mt-0.5"
                aria-label={`Сценарий «${SCENARIOS[sc.key].label}»`}
                checked={sc.enabled}
                disabled={busy === sc.key}
                onCheckedChange={(v) => void toggle(sc, v)}
              />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">{SCENARIOS[sc.key].label}</div>
                <div className="text-sm text-muted-foreground">
                  {scenarioRule(sc.key, sc.params)}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  {stage ? (
                    <span className="flex items-center gap-1.5">
                      <StageDot color={stage.color} />
                      {pipeline?.name} → {stage.name}
                    </span>
                  ) : (
                    <span className="text-amber-700">Этап не выбран</span>
                  )}
                  <span>Задача: {sc.task_title}</span>
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Настроить сценарий"
                title="Настроить"
                onClick={() => setEditing(sc)}
              >
                <Pencil />
              </Button>
            </li>
          );
        })}
      </ul>
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          {editing && (
            <ScenarioForm key={editing.key} scenario={editing} onDone={() => setEditing(null)} />
          )}
        </DialogContent>
      </Dialog>
      {confirmDialog}
    </Panel>
  );
}

function ScenarioForm({ scenario, onDone }: { scenario: CrmScenario; onDone: () => void }) {
  const qc = useQueryClient();
  const { data: setup } = useQuery(crmSetupQuery);
  const meta = SCENARIOS[scenario.key];
  const pipelines = (setup?.pipelines ?? []).filter((p) => !p.is_archived);
  const [pipelineId, setPipelineId] = useState(scenario.pipeline_id ?? pipelines[0]?.id ?? "");
  const stages = (setup?.stages ?? []).filter(
    (s) => s.pipeline_id === pipelineId && s.kind === "open",
  );
  const [stageId, setStageId] = useState(scenario.stage_id ?? "");
  const [days, setDays] = useState(String(scenario.params.days ?? 7));
  const [left, setLeft] = useState(String(scenario.params.left ?? 2));
  const [task, setTask] = useState(scenario.task_title);
  const [saving, setSaving] = useState(false);
  const [count, setCount] = useState<number | null>(null);
  const [counting, setCounting] = useState(false);

  const params = () => ({
    days: Math.max(0, Math.round(numberOrNull(days) ?? 0)),
    ...(scenario.key === "expiring"
      ? { left: Math.max(0, Math.round(numberOrNull(left) ?? 0)) }
      : {}),
  });
  const stageOk = stages.some((s) => s.id === stageId);

  const check = async () => {
    setCounting(true);
    try {
      setCount(await previewScenario(scenario.key, params()));
    } catch (e) {
      toast.error(crmErrorText(e, "Не удалось посчитать"));
    } finally {
      setCounting(false);
    }
  };

  const save = async () => {
    if (!stageOk) return void toast.error("Выберите этап, в который ставить сделки");
    if (!task.trim()) return void toast.error("Напишите текст задачи");
    setSaving(true);
    try {
      await saveScenario(scenario.key, { stage_id: stageId, params: params(), task_title: task });
      await invalidateCrm(qc);
      onDone();
    } catch (e) {
      toast.error(crmErrorText(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Сценарий «{meta.label}»</DialogTitle>
        <DialogDescription>{meta.hint}</DialogDescription>
      </DialogHeader>
      <DialogForm onSubmit={() => void save()}>
        <DialogBody>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <FormField label={meta.daysLabel} required>
                <Input
                  inputMode="numeric"
                  value={days}
                  onChange={(e) => {
                    setDays(e.target.value);
                    setCount(null);
                  }}
                />
              </FormField>
              {scenario.key === "expiring" && (
                <FormField
                  label="Или осталось тренировок, не больше"
                  tip="Сделка заведётся и тогда, когда срок ещё не кончается, но тренировок осталось столько или меньше."
                  required
                >
                  <Input
                    inputMode="numeric"
                    value={left}
                    onChange={(e) => {
                      setLeft(e.target.value);
                      setCount(null);
                    }}
                  />
                </FormField>
              )}
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField label="Воронка" required>
                <Select
                  value={pipelineId}
                  onValueChange={(v) => {
                    setPipelineId(v);
                    setStageId("");
                  }}
                >
                  <SelectTrigger aria-label="Воронка">
                    <SelectValue placeholder="Выберите воронку" />
                  </SelectTrigger>
                  <SelectContent>
                    {pipelines.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
              <FormField label="Этап для новых сделок" required>
                <StageSelect stages={stages} value={stageOk ? stageId : ""} onChange={setStageId} />
              </FormField>
            </div>
            <FormField
              label="Задача ответственному"
              tip="Первая задача сделки. В комментарий к ней попадёт причина: какой абонемент, до какого числа, сколько осталось."
              required
            >
              <Input value={task} maxLength={500} onChange={(e) => setTask(e.target.value)} />
            </FormField>
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="outline" size="sm" disabled={counting} onClick={() => void check()}>
                {counting && <Loader2 className="animate-spin" />}
                Сколько клиентов подходит сейчас
              </Button>
              {count !== null && (
                <span className="text-sm font-medium">
                  {count} {plural(count, "клиент", "клиента", "клиентов")}
                </span>
              )}
            </div>
            <InfoNote>{meta.closes}</InfoNote>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button type="submit" disabled={saving}>
            {saving && <Loader2 className="animate-spin" />}
            Сохранить
          </Button>
        </DialogFooter>
      </DialogForm>
    </>
  );
}

// Формы сайта --------------------------------------------------------------------

/** «Формы сайта»: у формы свой адрес приёма заявок и готовый код для сайта. */
export function LeadFormsPanel() {
  const qc = useQueryClient();
  const { data: forms = [] } = useQuery(crmLeadFormsQuery);
  const { data: studios = [] } = useCrmStudios();
  const { confirm, confirmDialog } = useConfirm();
  const [editing, setEditing] = useState<CrmLeadForm | "new" | null>(null);
  const [code, setCode] = useState<CrmLeadForm | null>(null);

  const remove = async (form: CrmLeadForm) => {
    const ok = await confirm({
      title: `Удалить форму «${form.name}»?`,
      description: "Адрес формы перестанет принимать заявки. Уже пришедшие сделки останутся.",
    });
    if (!ok) return;
    try {
      await deleteLeadForm(form.id);
      await invalidateCrm(qc);
    } catch (e) {
      toast.error(crmErrorText(e, "Не удалось удалить"));
    }
  };

  return (
    <Panel
      title="Формы сайта"
      action={
        <Button variant="outline" size="xs" onClick={() => setEditing("new")}>
          <Plus />
          Форма
        </Button>
      }
    >
      {forms.length === 0 ? (
        <p className="px-3 py-4 text-center text-sm text-muted-foreground">
          Форм нет. Добавьте форму — получите адрес и код для сайта: заявки с него станут сделками
          с источником и utm-метками рекламы.
        </p>
      ) : (
        <ul className="divide-y">
          {forms.map((f) => (
            <li key={f.id} className="flex items-center gap-2 px-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <span className="truncate">{f.name}</span>
                  {!f.is_active && (
                    <span className="rounded-full bg-muted px-1.5 py-0.5 text-[11px] font-normal text-muted-foreground">
                      выключена
                    </span>
                  )}
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  Источник: {f.source ?? f.name} ·{" "}
                  {studios.find((s) => s.id === f.studio_id)?.name ?? "по распределению"} · заявок:{" "}
                  {f.leads_count}
                </div>
              </div>
              <Button variant="outline" size="xs" onClick={() => setCode(f)}>
                <Code />
                Код для сайта
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Изменить"
                title="Изменить"
                onClick={() => setEditing(f)}
              >
                <Pencil />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Удалить"
                title="Удалить"
                onClick={() => void remove(f)}
              >
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          {editing && (
            <LeadFormForm
              key={editing === "new" ? "new" : editing.id}
              form={editing === "new" ? null : editing}
              onDone={() => setEditing(null)}
            />
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={!!code} onOpenChange={(o) => !o && setCode(null)}>
        <DialogContent className="sm:max-w-2xl">{code && <LeadFormCode form={code} />}</DialogContent>
      </Dialog>
      {confirmDialog}
    </Panel>
  );
}

function LeadFormForm({ form, onDone }: { form: CrmLeadForm | null; onDone: () => void }) {
  const qc = useQueryClient();
  const { data: setup } = useQuery(crmSetupQuery);
  const { data: studios = [] } = useCrmStudios();
  const pipelines = (setup?.pipelines ?? []).filter((p) => !p.is_archived);
  const [name, setName] = useState(form?.name ?? "");
  const [source, setSource] = useState(form?.source ?? "");
  const [pipelineId, setPipelineId] = useState(form?.pipeline_id ?? pipelines[0]?.id ?? "");
  const [studioId, setStudioId] = useState(form?.studio_id ?? NONE);
  const [active, setActive] = useState(form?.is_active ?? true);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!name.trim()) return void toast.error("Назовите форму");
    setSaving(true);
    try {
      await saveLeadForm(form?.id ?? null, {
        name,
        source: source.trim() || null,
        pipeline_id: pipelineId || null,
        studio_id: studioId === NONE ? null : studioId,
        is_active: active,
      });
      await invalidateCrm(qc);
      onDone();
    } catch (e) {
      toast.error(crmErrorText(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{form ? "Форма сайта" : "Новая форма сайта"}</DialogTitle>
        <DialogDescription>
          Заявка с формы становится сделкой в первом этапе воронки, с задачей ответственному.
        </DialogDescription>
      </DialogHeader>
      <DialogForm onSubmit={() => void save()}>
        <DialogBody>
          <div className="space-y-4">
            <FormField label="Название" required>
              <Input
                value={name}
                maxLength={80}
                placeholder="Лендинг «Пробное занятие»"
                onChange={(e) => setName(e.target.value)}
              />
            </FormField>
            <FormField label="Источник сделки" tip={TIPS.formSource}>
              <SourceInput value={source} onChange={setSource} placeholder={name || "Сайт"} />
            </FormField>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField label="Воронка" required>
                <Select value={pipelineId} onValueChange={setPipelineId}>
                  <SelectTrigger aria-label="Воронка">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {pipelines.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
              <FormField label="Клуб" tip={TIPS.formStudio}>
                <Select value={studioId} onValueChange={setStudioId}>
                  <SelectTrigger aria-label="Клуб">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>По распределению</SelectItem>
                    {studios.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
            </div>
            <SwitchRow
              title="Принимать заявки"
              hint="Выключенная форма заявки не принимает — сайт получит ошибку."
              checked={active}
              onCheckedChange={setActive}
            />
          </div>
        </DialogBody>
        <DialogFooter>
          <Button type="submit" disabled={saving}>
            {saving && <Loader2 className="animate-spin" />}
            Сохранить
          </Button>
        </DialogFooter>
      </DialogForm>
    </>
  );
}

function LeadFormCode({ form }: { form: CrmLeadForm }) {
  const url = leadFormUrl(window.location.origin, form.token);
  const snippet = leadFormSnippet(url);
  return (
    <>
      <DialogHeader>
        <DialogTitle>Форма «{form.name}» — подключение к сайту</DialogTitle>
        <DialogDescription>
          Сайт отправляет заявку на адрес формы — в CRM появляется сделка. Нужен телефон или почта.
        </DialogDescription>
      </DialogHeader>
      <DialogBody>
        <div className="space-y-4">
          <FormField
            label="Адрес приёма заявок"
            hint="Для конструкторов (Tilda: «Формы» → «Webhook») — вставьте этот адрес. Поля: name, phone, email, message; utm-метки и адрес страницы передаются так же."
          >
            <div className="flex gap-2">
              <Input readOnly value={url} onFocus={(e) => e.target.select()} />
              <Button variant="outline" onClick={() => void copy(url, "Адрес скопирован")}>
                <Copy />
                Скопировать
              </Button>
            </div>
          </FormField>
          <FormField
            label="Готовый код формы"
            hint="Вставьте в HTML страницы. Форма сама передаёт utm-метки из адреса страницы — по ним видно, какая реклама привела клиента."
          >
            <Textarea readOnly rows={10} value={snippet} className="font-mono text-xs" />
          </FormField>
          <Button variant="outline" onClick={() => void copy(snippet, "Код скопирован")}>
            <Copy />
            Скопировать код
          </Button>
          <InfoNote>
            Адрес формы — её ключ: не публикуйте его отдельно от сайта. Если на адрес пошёл спам —
            удалите форму и создайте новую.
          </InfoNote>
        </div>
      </DialogBody>
    </>
  );
}

/** Источник: поле с подсказкой уже встречавшихся названий. */
function SourceInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const { data: names = [] } = useQuery(crmSourceNamesQuery);
  return (
    <>
      <Input
        value={value}
        maxLength={120}
        list="crm-source-names"
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
      <datalist id="crm-source-names">
        {names.map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>
    </>
  );
}

// Ссылки и QR-коды -----------------------------------------------------------------

const LINK_KINDS: { value: CrmLink["target_kind"]; label: string }[] = [
  { value: "whatsapp", label: "WhatsApp" },
  { value: "telegram", label: "Telegram-бот" },
  { value: "url", label: "Сайт" },
];

/** «Ссылки и QR-коды» с меткой источника: для рекламы, листовок, блогеров. */
export function LinksPanel() {
  const qc = useQueryClient();
  const { data: links = [] } = useQuery(crmLinksQuery);
  const { data: deals } = useLinkDeals();
  const { confirm, confirmDialog } = useConfirm();
  const [editing, setEditing] = useState<CrmLink | "new" | null>(null);
  const [qr, setQr] = useState<CrmLink | null>(null);

  const remove = async (link: CrmLink) => {
    const ok = await confirm({
      title: `Удалить ссылку «${link.name}»?`,
      description:
        "Ссылка и её QR-код перестанут открываться. Если она уже напечатана или стоит в рекламе — лучше выключить, а не удалять.",
    });
    if (!ok) return;
    try {
      await deleteLink(link.id);
      await invalidateCrm(qc);
    } catch (e) {
      toast.error(crmErrorText(e, "Не удалось удалить"));
    }
  };

  return (
    <Panel
      title="Ссылки и QR-коды с меткой"
      action={
        <Button variant="outline" size="xs" onClick={() => setEditing("new")}>
          <Plus />
          Ссылка
        </Button>
      }
    >
      {links.length === 0 ? (
        <p className="px-3 py-4 text-center text-sm text-muted-foreground">
          Ссылок нет. Ссылка ведёт клиента в WhatsApp, к Telegram-боту или на сайт и запоминает,
          откуда он пришёл: своя ссылка на каждую рекламу, листовку или блогера.
        </p>
      ) : (
        <ul className="divide-y">
          {links.map((l) => (
            <li key={l.id} className="flex items-center gap-2 px-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <span className="truncate">{l.name}</span>
                  {!l.is_active && (
                    <span className="rounded-full bg-muted px-1.5 py-0.5 text-[11px] font-normal text-muted-foreground">
                      выключена
                    </span>
                  )}
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  {l.source}
                  {l.campaign ? ` · ${l.campaign}` : ""} ·{" "}
                  {LINK_KINDS.find((k) => k.value === l.target_kind)?.label} · переходов: {l.clicks}
                  {l.target_kind !== "url" ? ` · сделок: ${deals?.get(l.id) ?? 0}` : ""}
                </div>
              </div>
              <Button
                variant="outline"
                size="xs"
                onClick={() =>
                  void copy(linkPublicUrl(window.location.origin, l.code), "Ссылка скопирована")
                }
              >
                <Copy />
                Ссылка
              </Button>
              <Button variant="outline" size="xs" onClick={() => setQr(l)}>
                <QrCode />
                QR
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Изменить"
                title="Изменить"
                onClick={() => setEditing(l)}
              >
                <Pencil />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Удалить"
                title="Удалить"
                onClick={() => void remove(l)}
              >
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          {editing && (
            <LinkForm
              key={editing === "new" ? "new" : editing.id}
              link={editing === "new" ? null : editing}
              onDone={() => setEditing(null)}
            />
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={!!qr} onOpenChange={(o) => !o && setQr(null)}>
        <DialogContent className="sm:max-w-sm">{qr && <LinkQr link={qr} />}</DialogContent>
      </Dialog>
      {confirmDialog}
    </Panel>
  );
}

function LinkForm({ link, onDone }: { link: CrmLink | null; onDone: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState(link?.name ?? "");
  const [source, setSource] = useState(link?.source ?? "");
  const [campaign, setCampaign] = useState(link?.campaign ?? "");
  const [kind, setKind] = useState<CrmLink["target_kind"]>(link?.target_kind ?? "whatsapp");
  const [target, setTarget] = useState(link?.target ?? "");
  const [text, setText] = useState(link?.text ?? "");
  const [active, setActive] = useState(link?.is_active ?? true);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!name.trim()) return void toast.error("Назовите ссылку");
    if (!source.trim()) return void toast.error("Укажите источник");
    const check = linkRedirectUrl({
      code: "test",
      source,
      campaign: campaign || null,
      target_kind: kind,
      target,
      text: text || null,
    });
    if (!check)
      return void toast.error(
        kind === "whatsapp"
          ? "Укажите номер WhatsApp с кодом страны"
          : kind === "telegram"
            ? "Укажите ник бота: @name_bot"
            : "Укажите адрес сайта, начиная с https://",
      );
    setSaving(true);
    try {
      await saveLink(link?.id ?? null, {
        name,
        source,
        campaign: campaign.trim() || null,
        target_kind: kind,
        target,
        text: kind === "whatsapp" ? text.trim() || null : null,
        is_active: active,
      });
      await invalidateCrm(qc);
      onDone();
    } catch (e) {
      toast.error(crmErrorText(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{link ? "Ссылка с меткой" : "Новая ссылка с меткой"}</DialogTitle>
        <DialogDescription>
          Клиент переходит по ссылке или QR-коду — сделка получает её источник.
        </DialogDescription>
      </DialogHeader>
      <DialogForm onSubmit={() => void save()}>
        <DialogBody>
          <div className="space-y-4">
            <FormField label="Название" required>
              <Input
                value={name}
                maxLength={120}
                placeholder="Листовка у метро"
                onChange={(e) => setName(e.target.value)}
              />
            </FormField>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField label="Источник" tip={TIPS.linkSource} required>
                <SourceInput value={source} onChange={setSource} placeholder="Листовки" />
              </FormField>
              <FormField label="Кампания" tip={TIPS.linkCampaign}>
                <Input
                  value={campaign}
                  maxLength={200}
                  placeholder="Ваке, ноябрь"
                  onChange={(e) => setCampaign(e.target.value)}
                />
              </FormField>
            </div>
            <FormField label="Куда ведёт" required>
              <SegmentedControl
                aria-label="Куда ведёт ссылка"
                value={kind}
                onChange={setKind}
                options={LINK_KINDS}
              />
            </FormField>
            <FormField
              label={
                kind === "whatsapp"
                  ? "Номер WhatsApp"
                  : kind === "telegram"
                    ? "Ник Telegram-бота"
                    : "Адрес страницы"
              }
              hint={
                kind === "whatsapp"
                  ? "Номер, подключённый к CRM, с кодом страны."
                  : kind === "telegram"
                    ? "Бот, подключённый к CRM в «Каналах»."
                    : "К адресу добавятся utm-метки источника и кампании — форма сайта передаст их в сделку."
              }
              required
            >
              <Input
                value={target}
                maxLength={1000}
                placeholder={
                  kind === "whatsapp"
                    ? "+995 555 12 34 56"
                    : kind === "telegram"
                      ? "@base40_bot"
                      : "https://"
                }
                onChange={(e) => setTarget(e.target.value)}
              />
            </FormField>
            {kind === "whatsapp" && (
              <FormField label="Текст сообщения клиента" tip={TIPS.linkText}>
                <Input
                  value={text}
                  maxLength={500}
                  placeholder="Здравствуйте! Хочу записаться на пробное занятие"
                  onChange={(e) => setText(e.target.value)}
                />
              </FormField>
            )}
            {link && (
              <SwitchRow
                title="Ссылка работает"
                hint="Выключенная ссылка не открывается."
                checked={active}
                onCheckedChange={setActive}
              />
            )}
          </div>
        </DialogBody>
        <DialogFooter>
          <Button type="submit" disabled={saving}>
            {saving && <Loader2 className="animate-spin" />}
            Сохранить
          </Button>
        </DialogFooter>
      </DialogForm>
    </>
  );
}

function LinkQr({ link }: { link: CrmLink }) {
  const url = linkPublicUrl(window.location.origin, link.code);
  const [png, setPng] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Библиотека нужна только здесь — отдельным чанком.
    void import("qrcode").then((m) =>
      m.default.toDataURL(url, { width: 800, margin: 2 }).then(
        (data) => !cancelled && setPng(data),
        () => !cancelled && setPng(null),
      ),
    );
    return () => {
      cancelled = true;
    };
  }, [url]);

  return (
    <>
      <DialogHeader>
        <DialogTitle>QR-код «{link.name}»</DialogTitle>
        <DialogDescription className="break-all">{url}</DialogDescription>
      </DialogHeader>
      <DialogBody>
        <div className="flex flex-col items-center gap-4">
          {png ? (
            <img src={png} alt="QR-код ссылки" className="size-56 rounded-md border" />
          ) : (
            <div className="size-56 animate-pulse rounded-md bg-muted" />
          )}
          <Button asChild variant="outline" disabled={!png}>
            <a href={png ?? "#"} download={`qr-${link.code}.png`}>
              Скачать PNG
            </a>
          </Button>
        </div>
      </DialogBody>
    </>
  );
}

// Расходы на рекламу ---------------------------------------------------------------

/** «Расходы на рекламу» — по месяцам и источникам; из них цена заявки и клиента. */
export function AdSpendPanel() {
  const qc = useQueryClient();
  const { data: rows = [] } = useQuery(crmAdSpendQuery);
  const { data: studios = [] } = useCrmStudios();
  const { confirm, confirmDialog } = useConfirm();
  const [editing, setEditing] = useState<CrmAdSpend | "new" | null>(null);

  const remove = async (row: CrmAdSpend) => {
    if (!(await confirm({ title: `Удалить расход «${row.source}» за ${monthLabel(row.month)}?` })))
      return;
    try {
      await deleteAdSpend(row.id);
      await invalidateCrm(qc);
    } catch (e) {
      toast.error(crmErrorText(e, "Не удалось удалить"));
    }
  };

  return (
    <Panel
      title="Расходы на рекламу"
      action={
        <Button variant="outline" size="xs" onClick={() => setEditing("new")}>
          <Plus />
          Расход
        </Button>
      }
    >
      {rows.length === 0 ? (
        <p className="px-3 py-4 text-center text-sm text-muted-foreground">
          Расходы не внесены. Внесите, сколько потрачено на источник за месяц, — отчёт посчитает
          стоимость заявки, стоимость клиента и окупаемость.
        </p>
      ) : (
        <ul className="divide-y">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center gap-2 px-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">
                  {r.source}
                  {r.campaign ? ` · ${r.campaign}` : ""}
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  {monthLabel(r.month)}
                  {r.studio_id ? ` · ${studios.find((s) => s.id === r.studio_id)?.name ?? ""}` : ""}
                  {r.note ? ` · ${r.note}` : ""}
                </div>
              </div>
              <span className="shrink-0 text-sm font-medium tabular-nums">
                {formatMoney(r.amount)}
              </span>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Изменить"
                title="Изменить"
                onClick={() => setEditing(r)}
              >
                <Pencil />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Удалить"
                title="Удалить"
                onClick={() => void remove(r)}
              >
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          {editing && (
            <AdSpendForm
              key={editing === "new" ? "new" : editing.id}
              row={editing === "new" ? null : editing}
              onDone={() => setEditing(null)}
            />
          )}
        </DialogContent>
      </Dialog>
      {confirmDialog}
    </Panel>
  );
}

function AdSpendForm({ row, onDone }: { row: CrmAdSpend | null; onDone: () => void }) {
  const qc = useQueryClient();
  const { data: studios = [] } = useCrmStudios();
  const [month, setMonth] = useState((row?.month ?? monthOf(todayISO())).slice(0, 7));
  const [source, setSource] = useState(row?.source ?? "");
  const [campaign, setCampaign] = useState(row?.campaign ?? "");
  const [studioId, setStudioId] = useState(row?.studio_id ?? NONE);
  const [amount, setAmount] = useState(row ? String(row.amount) : "");
  const [note, setNote] = useState(row?.note ?? "");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const sum = numberOrNull(amount);
    if (!/^\d{4}-\d{2}$/.test(month)) return void toast.error("Выберите месяц");
    if (!source.trim()) return void toast.error("Укажите источник");
    if (sum === null || sum < 0) return void toast.error("Укажите сумму");
    setSaving(true);
    try {
      await saveAdSpend(row?.id ?? null, {
        month: `${month}-01`,
        source,
        campaign: campaign.trim() || null,
        studio_id: studioId === NONE ? null : studioId,
        amount: sum,
        note: note.trim() || null,
      });
      await invalidateCrm(qc);
      onDone();
    } catch (e) {
      toast.error(crmErrorText(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{row ? "Расход на рекламу" : "Новый расход на рекламу"}</DialogTitle>
        <DialogDescription>
          Сумма за месяц. В отчёте за часть месяца расход берётся по дням.
        </DialogDescription>
      </DialogHeader>
      <DialogForm onSubmit={() => void save()}>
        <DialogBody>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <FormField label="Месяц" required>
                <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
              </FormField>
              <FormField label="Сумма, ₾" required>
                <Input
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </FormField>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField label="Источник" tip={TIPS.spendSource} required>
                <SourceInput value={source} onChange={setSource} placeholder="Instagram" />
              </FormField>
              <FormField label="Кампания">
                <Input
                  value={campaign}
                  maxLength={200}
                  onChange={(e) => setCampaign(e.target.value)}
                />
              </FormField>
            </div>
            <FormField label="Клуб" tip="Если реклама шла на один клуб. Общая — «Все клубы».">
              <Select value={studioId} onValueChange={setStudioId}>
                <SelectTrigger aria-label="Клуб">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Все клубы</SelectItem>
                  {studios.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            <FormField label="Комментарий">
              <Input value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
            </FormField>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button type="submit" disabled={saving}>
            {saving && <Loader2 className="animate-spin" />}
            Сохранить
          </Button>
        </DialogFooter>
      </DialogForm>
    </>
  );
}
