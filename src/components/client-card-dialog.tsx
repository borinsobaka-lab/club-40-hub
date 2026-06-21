import { useEffect, useState } from "react";
import { ExternalLink, Loader2, Pencil } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type ClientLike = {
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
  avatar_url: string | null;
};

function initials(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((s) => s[0]?.toUpperCase() ?? "")
      .join("") || "?"
  );
}

function displayName(c: Pick<ClientLike, "first_name" | "last_name" | "full_name">) {
  return [c.last_name, c.first_name].filter(Boolean).join(" ").trim() || c.full_name || "—";
}

function formatDate(v: string | null | undefined) {
  if (!v) return "—";
  try {
    return new Date(v).toLocaleDateString("ru-RU");
  } catch {
    return v;
  }
}

function formatMoney(n: number) {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: 0,
  }).format(n);
}

function genderLabel(g: string | null) {
  if (g === "male") return "Мужской";
  if (g === "female") return "Женский";
  return "—";
}

type SaleRow = {
  id: string;
  sold_at: string;
  total_amount: number;
  down_payment_amount: number;
  remaining_installments: number;
  admin_name: string | null;
  comment: string | null;
  memberships: { name: string } | null;
};

export function ClientCardDialog({
  open,
  onOpenChange,
  client,
  onEdit,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  client: ClientLike | null;
  onEdit?: (c: ClientLike) => void;
}) {
  const [sales, setSales] = useState<SaleRow[]>([]);
  const [loadingSales, setLoadingSales] = useState(false);

  useEffect(() => {
    if (!open || !client?.id) {
      setSales([]);
      return;
    }
    let cancelled = false;
    setLoadingSales(true);
    supabase
      .from("sales")
      .select("id, sold_at, total_amount, installments, admin_name, comment, memberships(name)")
      .eq("client_id", client.id)
      .order("sold_at", { ascending: false })
      .then(({ data, error }) => {
        if (cancelled) return;
        setLoadingSales(false);
        if (!error) setSales((data as unknown as SaleRow[]) ?? []);
      });
    return () => {
      cancelled = true;
    };
  }, [open, client?.id]);

  if (!client) return null;
  const name = displayName(client);
  const photo = client.avatar_url || client.photo_url || "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="sr-only">Карточка клиента {name}</DialogTitle>
        </DialogHeader>

        <div className="max-h-[75vh] space-y-5 overflow-y-auto pr-1">
          <div className="flex items-start gap-4">
            <Avatar className="h-20 w-20">
              {photo && <AvatarImage src={photo} alt={name} />}
              <AvatarFallback className="text-lg">{initials(name)}</AvatarFallback>
            </Avatar>
            <div className="flex-1">
              <div className="text-xl font-semibold">{name}</div>
              <div className="text-sm text-muted-foreground">
                {client.phone || "—"} {client.email ? `· ${client.email}` : ""}
              </div>
              {client.crm_link && (
                <a
                  href={client.crm_link}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 inline-flex items-center gap-1 text-sm text-primary hover:underline"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  Открыть в CRM
                </a>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-x-6 gap-y-2 rounded-lg border bg-muted/30 p-3 text-sm">
            <Field label="Пол" value={genderLabel(client.gender)} />
            <Field label="Дата рождения" value={formatDate(client.birthday)} />
            <Field label="Регистрация" value={formatDate(client.registration_date)} />
            <Field label="Последний визит" value={formatDate(client.last_visit_date)} />
          </div>

          {client.notes && (
            <div>
              <div className="mb-1 text-xs uppercase text-muted-foreground">Заметки</div>
              <div className="whitespace-pre-wrap rounded-lg border bg-background p-3 text-sm">
                {client.notes}
              </div>
            </div>
          )}

          <div>
            <div className="mb-2 text-xs uppercase text-muted-foreground">История продаж</div>
            {loadingSales ? (
              <div className="flex justify-center py-4">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : sales.length === 0 ? (
              <div className="rounded-lg border bg-background p-4 text-center text-sm text-muted-foreground">
                Продаж пока нет.
              </div>
            ) : (
              <ul className="divide-y rounded-lg border bg-background">
                {sales.map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                    <div className="min-w-0">
                      <div className="font-medium truncate">
                        {s.memberships?.name ?? "Абонемент удалён"}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {formatDate(s.sold_at)}
                        {s.admin_name ? ` · ${s.admin_name}` : ""}
                        {s.installments > 1 ? ` · рассрочка ${s.installments} мес.` : ""}
                      </div>
                    </div>
                    <div className="shrink-0 font-medium">{formatMoney(Number(s.total_amount))}</div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <DialogFooter>
          {onEdit && (
            <Button variant="outline" onClick={() => onEdit(client)}>
              <Pencil className="mr-1 h-4 w-4" />
              Редактировать
            </Button>
          )}
          <Button onClick={() => onOpenChange(false)}>Закрыть</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs uppercase text-muted-foreground">{label}</div>
      <div>{value}</div>
    </div>
  );
}
