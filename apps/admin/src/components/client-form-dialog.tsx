import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useActiveStudio } from "@/hooks/use-studios";
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
  email: string | null;
  birthday: string | null;
  gender: string | null;
  notes: string | null;
  registration_date: string | null;
  last_visit_date: string | null;
  crm_link: string | null;
  photo_url: string | null;
};

/** Сохранённый клиент — для тех, кто сразу его использует (пробное посещение). */
export type SavedClient = Pick<
  EditableClient,
  "id" | "full_name" | "first_name" | "last_name" | "phone" | "email"
> & { user_id: string | null };

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
    const mailError = emailError(email);
    if (mailError) {
      toast.error(`Email: ${mailError}`);
      return;
    }
    setSaving(true);
    try {
      const fullName = [ln, fn].filter(Boolean).join(" ");
      const payload = {
        studio_id: studioId,
        first_name: fn || null,
        last_name: ln || null,
        full_name: fullName,
        phone: phoneCheck.status === "valid" ? phoneCheck.e164 : null,
        email: email || null,
        birthday: birthday || null,
        gender: gender || null,
        notes: notes.trim() || null,
        registration_date: registrationDate || null,
        last_visit_date: lastVisitDate || null,
        crm_link: crmLink.trim() || null,
      };
      const saved = "id, user_id, full_name, first_name, last_name, phone, email";
      const { data, error } = client
        ? await supabase.from("clients").update(payload).eq("id", client.id).select(saved).single()
        : await supabase.from("clients").insert(payload).select(saved).single();
      if (error || !data) {
        toast.error("Ошибка сохранения: " + (error?.message ?? "база не вернула клиента"));
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
              <FormField label="Телефон" tip={CLIENT_TIPS.phone}>
                <PhoneInput value={phone} onChange={setPhone} showError={submitted} />
              </FormField>
              <FormField label="Email" tip={CLIENT_TIPS.email}>
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
            <FormField label="Заметки" tip={CLIENT_TIPS.notes} optional>
              <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </FormField>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Отмена
          </Button>
          <Button type="submit" disabled={saving}>
            {saving && <Loader2 className="animate-spin" />}
            Сохранить
          </Button>
        </DialogFooter>
      </DialogForm>
    </>
  );
}
