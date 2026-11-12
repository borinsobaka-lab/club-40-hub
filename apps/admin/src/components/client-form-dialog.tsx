import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Plus, X } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useActiveStudio } from "@/hooks/use-studios";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { unwrap } from "@/lib/query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/ui/form-field";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { EmailInput, PhoneInput, type PhoneValue } from "@/components/contact-inputs";
import { CLIENT_TIPS } from "@/lib/client-fields";
import { checkPhone, emailError, phoneForEditing } from "@/lib/contacts";
import { GENDER_OPTIONS, todayISO } from "@/lib/format";

// Диалог «Новый клиент» / «Редактировать клиента»: раздел «Клиенты» и
// «Пробное посещение» в расписании (новый клиент сразу записывается на занятие).

/** Поля карточки клиента, которые правит форма. */
export type EditableClient = {
  id: string;
  full_name: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  /** Второй телефон (по желанию); E.164, как phone. */
  phone2?: string | null;
  email: string | null;
  birthday: string | null;
  gender: string | null;
  notes: string | null;
  registration_date: string | null;
  last_visit_date: string | null;
  crm_link: string | null;
  photo_url: string | null;
};

/**
 * Сохранённый клиент — для тех, кто сразу его использует: пробное посещение
 * записывает нового, карточка клиента показывает правку без перезапроса.
 */
export type SavedClient = Omit<EditableClient, "id"> & { id: string; user_id: string | null };

type ClientDialogProps = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  studioId: string | null;
  client: EditableClient | null;
  onSaved: (saved: SavedClient) => void;
  /** Заголовок и пояснение нового клиента вместо стандартных (пробное посещение). */
  createTitle?: string;
  createDescription?: string;
};

export function ClientDialog(props: ClientDialogProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-w-lg">
        {/* Форма монтируется заново при каждом открытии — сбрасывать её не нужно. */}
        <ClientForm key={props.client?.id ?? "new"} {...props} />
      </DialogContent>
    </Dialog>
  );
}

/**
 * Почта или номер уже у другой карточки той же базы клиентов (пакетные клубы —
 * вся сеть, подписочный — свой клуб): RPC client_contact_check, схема —
 * db/migrations/2026-11-12_zz_client_contacts_unique.sql. Сохранить такую
 * карточку не даёт и база (ошибка 23505) — здесь подсказка заранее.
 */
type ContactConflict = {
  field: "email" | "phone";
  /** Почта в нижнем регистре или номер цифрами (с 995 у грузинского мобильного). */
  value: string;
  client_id: string;
  full_name: string | null;
  studio_name: string | null;
};

/** Номер для сравнения — как client_phone_key в базе. */
function phoneKey(raw: string | null): string | null {
  const d = (raw ?? "").replace(/\D/g, "");
  if (d.length < 6) return null;
  return d.length === 9 && d.startsWith("5") ? `995${d}` : d;
}

function conflictText(c: ContactConflict) {
  const name = c.full_name?.trim() || "без имени";
  return `Уже указан у клиента «${name}»${c.studio_name ? ` (клуб «${c.studio_name}»)` : ""}. У двух клиентов не может быть одинаковых контактов.`;
}

// У старых записей имя и фамилия не разнесены — есть только full_name.
function initialNames(client: EditableClient | null) {
  const first = client?.first_name ?? "";
  const last = client?.last_name ?? "";
  if (first || last || !client?.full_name) return { first, last };
  // full_name везде пишется как «Фамилия Имя» (сохранение ниже, триггер
  // handle_new_user) — первое слово фамилия. Раньше бралось как имя, и
  // сохранение без правок меняло имя и фамилию местами.
  const parts = client.full_name.trim().split(/\s+/);
  if (parts.length === 1) return { first: parts[0], last: "" };
  return { first: parts.slice(1).join(" "), last: parts[0] };
}

function ClientForm({
  onOpenChange,
  studioId,
  client,
  onSaved,
  createTitle,
  createDescription,
}: ClientDialogProps) {
  const [firstName, setFirstName] = useState(() => initialNames(client).first);
  const [lastName, setLastName] = useState(() => initialNames(client).last);
  const [phone, setPhone] = useState<PhoneValue>(() => phoneForEditing(client?.phone));
  // Второй номер — по ссылке «Добавить ещё номер» под телефоном; уже
  // сохранённый виден сразу.
  const [phone2, setPhone2] = useState<PhoneValue>(() => phoneForEditing(client?.phone2));
  const [showPhone2, setShowPhone2] = useState(!!client?.phone2);
  const [email, setEmail] = useState(client?.email ?? "");
  // После попытки сохранить ошибки полей видны и без ухода из них.
  const [submitted, setSubmitted] = useState(false);
  const [birthday, setBirthday] = useState(client?.birthday ?? "");
  // Новый клиент пакетной студии — по умолчанию женщина (решение владельца
  // 2026-10-11, залы в основном женские); администратор может поменять.
  const packages = useActiveStudio()?.format === "packages";
  const [gender, setGender] = useState(client ? (client.gender ?? "") : packages ? "female" : "");
  const [notes, setNotes] = useState(client?.notes ?? "");
  // Новому клиенту дата регистрации — сегодня (можно поменять при переносе истории).
  const [registrationDate, setRegistrationDate] = useState(
    client ? (client.registration_date ?? "") : todayISO(),
  );
  const [lastVisitDate, setLastVisitDate] = useState(client?.last_visit_date ?? "");
  const [crmLink, setCrmLink] = useState(client?.crm_link ?? "");
  // Фото ставит сам клиент в приложении; здесь — только показ.
  const photoUrl = client?.photo_url ?? "";
  const [saving, setSaving] = useState(false);

  // Контакты для проверки на совпадения — только корректные и новые (как в
  // базе: прежние совпадения не мешают править карточку).
  const oldKeys = [phoneKey(client?.phone ?? null), phoneKey(client?.phone2 ?? null)];
  const newPhone = (value: PhoneValue, shown = true) => {
    if (!shown) return null;
    const c = checkPhone(value.value, value.country);
    if (c.status !== "valid" || oldKeys.includes(phoneKey(c.e164))) return null;
    return c.e164;
  };
  const phoneE164 = newPhone(phone);
  const phone2E164 = newPhone(phone2, showPhone2);
  const emailNorm =
    email.trim() &&
    !emailError(email) &&
    email.trim().toLowerCase() !== (client?.email ?? "").trim().toLowerCase()
      ? email.trim().toLowerCase()
      : null;
  const contacts = useDebouncedValue(
    { email: emailNorm, phone: phoneE164, phone2: phone2E164 },
    400,
  );
  const conflictsQuery = useQuery({
    queryKey: [
      "client-contact-check",
      studioId,
      client?.id ?? null,
      contacts.email,
      contacts.phone,
      contacts.phone2,
    ],
    queryFn: () =>
      unwrap<ContactConflict[]>(
        supabase.rpc("client_contact_check", {
          p_studio: studioId!,
          p_client: client?.id ?? null,
          p_email: contacts.email,
          p_phone: contacts.phone,
          p_phone2: contacts.phone2,
        }),
      ),
    enabled: !!studioId && !!(contacts.email || contacts.phone || contacts.phone2),
    staleTime: 10_000,
  });
  // Совпадение показываем, только пока в поле то же значение, что проверяли.
  const conflicts = conflictsQuery.data ?? [];
  const emailConflict =
    emailNorm && emailNorm === contacts.email
      ? conflicts.find((c) => c.field === "email" && c.value === emailNorm)
      : undefined;
  const phoneConflictFor = (value: string | null, checked: string | null) => {
    const key = phoneKey(value);
    if (!key || value !== checked) return undefined;
    return conflicts.find((c) => c.field === "phone" && c.value === key);
  };
  const phoneConflict = phoneConflictFor(phoneE164, contacts.phone);
  const phone2Conflict = phoneConflictFor(phone2E164, contacts.phone2);
  const hasConflict = !!(emailConflict || phoneConflict || phone2Conflict);

  const handleSave = async () => {
    if (!studioId) return;
    const fn = firstName.trim();
    const ln = lastName.trim();
    if (!fn) {
      toast.error("Укажите имя");
      return;
    }
    setSubmitted(true);
    const phoneCheck = checkPhone(phone.value, phone.country);
    if (phoneCheck.status === "invalid") {
      toast.error(`Телефон: ${phoneCheck.error}`);
      return;
    }
    const phone2Check = showPhone2
      ? checkPhone(phone2.value, phone2.country)
      : ({ status: "empty" } as const);
    if (phone2Check.status === "invalid") {
      toast.error(`Второй телефон: ${phone2Check.error}`);
      return;
    }
    if (hasConflict) {
      toast.error("Такие почта или телефон уже есть у другого клиента");
      return;
    }
    const mailError = emailError(email);
    if (mailError) {
      toast.error(`Email: ${mailError}`);
      return;
    }
    setSaving(true);
    try {
      const fullName = [ln, fn].filter(Boolean).join(" ");
      const payload = {
        first_name: fn || null,
        last_name: ln || null,
        full_name: fullName,
        phone: phoneCheck.status === "valid" ? phoneCheck.e164 : null,
        // Карточку открыли из запроса без phone2 — его не трогаем, а не стираем.
        ...(client && client.phone2 === undefined && !showPhone2
          ? {}
          : { phone2: phone2Check.status === "valid" ? phone2Check.e164 : null }),
        email: email || null,
        birthday: birthday || null,
        gender: gender || null,
        // Комментарии — лентой (client_comments, 2026-11-01): поле есть только у
        // нового клиента, его текст база кладёт первым комментарием. Правка
        // прежнее поле не трогает.
        ...(client ? {} : { notes: notes.trim() || null }),
        registration_date: registrationDate || null,
        last_visit_date: lastVisitDate || null,
        crm_link: crmLink.trim() || null,
      };
      const saved =
        "id, user_id, full_name, first_name, last_name, phone, phone2, email, birthday, gender, notes, registration_date, last_visit_date, crm_link, photo_url";
      // Правка клуб карточки не меняет: карточку клиента другого клуба (поиск
      // в шапке) открывают и из активного клуба.
      const { data, error } = client
        ? await supabase.from("clients").update(payload).eq("id", client.id).select(saved).single()
        : await supabase
            .from("clients")
            .insert({ ...payload, studio_id: studioId })
            .select(saved)
            .single();
      if (error || !data) {
        // 23505 — почта или вход приложения уже у другой карточки: у пакетных
        // клубов карточка на человека одна (clients_network_unique_guard),
        // текст базы называет клиента.
        toast.error(
          error?.code === "23505"
            ? error.message
            : "Ошибка сохранения: " + (error?.message ?? "база не вернула клиента"),
        );
        return;
      }
      toast.success(client ? "Клиент обновлён" : "Клиент добавлен");
      onOpenChange(false);
      onSaved(data as SavedClient);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {client ? "Редактировать клиента" : (createTitle ?? "Новый клиент")}
        </DialogTitle>
        <DialogDescription>
          {(!client && createDescription) || "Контактные данные и заметки по клиенту."}
        </DialogDescription>
      </DialogHeader>
      <DialogForm onSubmit={handleSave}>
        <DialogBody>
          <div className="space-y-4">
            {/* Аватар слева от имени; на телефоне поля имени уходят в столбик рядом с ним. */}
            <div className="flex items-start gap-4">
              <div className="h-20 w-20 shrink-0 overflow-hidden rounded-full border bg-muted">
                {photoUrl ? (
                  <img
                    src={photoUrl}
                    alt={`${lastName} ${firstName}`.trim() || "Фото клиента"}
                    className="h-full w-full object-cover"
                    onError={(e) => {
                      e.currentTarget.style.display = "none";
                    }}
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-xl font-medium text-muted-foreground">
                    {(firstName || lastName || "?").trim().charAt(0).toUpperCase()}
                  </div>
                )}
              </div>
              <div className="grid min-w-0 flex-1 grid-cols-1 gap-3 sm:grid-cols-2">
                <FormField label="Фамилия">
                  <Input value={lastName} onChange={(e) => setLastName(e.target.value)} />
                </FormField>
                <FormField label="Имя" required>
                  <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} />
                </FormField>
              </div>
            </div>

            <FormField
              label="Сделка в amoCRM"
              tip="Ссылка на сделку клиента в amoCRM. Имя клиента в таблицах станет ссылкой на неё."
              optional
            >
              <Input
                type="url"
                value={crmLink}
                onChange={(e) => setCrmLink(e.target.value)}
                placeholder="https://your-account.amocrm.ru/leads/detail/..."
              />
            </FormField>

            {/* Телефон и почта — каждый на всю ширину: под полем подсказки и исправления. */}
            <div className="grid grid-cols-1 gap-3">
              <FormField
                label="Телефон"
                tip={CLIENT_TIPS.phone}
                error={phoneConflict && conflictText(phoneConflict)}
              >
                <PhoneInput value={phone} onChange={setPhone} showError={submitted} />
                {!showPhone2 && (
                  <Button variant="link" size="inline" onClick={() => setShowPhone2(true)}>
                    <Plus />
                    Добавить ещё номер
                  </Button>
                )}
              </FormField>
              {showPhone2 && (
                <FormField
                  label="Второй телефон"
                  tip={CLIENT_TIPS.phone2}
                  optional
                  error={phone2Conflict && conflictText(phone2Conflict)}
                >
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <PhoneInput value={phone2} onChange={setPhone2} showError={submitted} />
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Убрать второй номер"
                      title="Убрать второй номер"
                      onClick={() => {
                        setShowPhone2(false);
                        setPhone2(phoneForEditing(null));
                      }}
                    >
                      <X />
                    </Button>
                  </div>
                </FormField>
              )}
              <FormField
                label="Email"
                tip={CLIENT_TIPS.email}
                error={emailConflict && conflictText(emailConflict)}
              >
                <EmailInput value={email} onChange={setEmail} showError={submitted} />
              </FormField>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <FormField label="Дата рождения">
                <Input type="date" value={birthday} onChange={(e) => setBirthday(e.target.value)} />
              </FormField>
              <FormField label="Пол">
                <Select value={gender} onValueChange={setGender}>
                  <SelectTrigger>
                    <SelectValue placeholder="—" />
                  </SelectTrigger>
                  <SelectContent>
                    {GENDER_OPTIONS.map((g) => (
                      <SelectItem key={g.value} value={g.value}>
                        {g.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <FormField label="Дата регистрации" tip={CLIENT_TIPS.registration}>
                <Input
                  type="date"
                  value={registrationDate}
                  onChange={(e) => setRegistrationDate(e.target.value)}
                />
              </FormField>
              <FormField label="Последний визит" tip={CLIENT_TIPS.lastVisit}>
                <Input
                  type="date"
                  value={lastVisitDate}
                  onChange={(e) => setLastVisitDate(e.target.value)}
                />
              </FormField>
            </div>
            {!client && (
              <FormField label="Комментарий" tip={CLIENT_TIPS.notes} optional>
                <Textarea note rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
              </FormField>
            )}
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Отмена
          </Button>
          <Button type="submit" disabled={saving || hasConflict}>
            {saving && <Loader2 className="animate-spin" />}
            Сохранить
          </Button>
        </DialogFooter>
      </DialogForm>
    </>
  );
}
