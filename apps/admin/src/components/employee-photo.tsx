import type * as React from "react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { initials } from "@/lib/format";
import { TRAINER_ROLES, type TrainerRole } from "@/lib/staff-directory";
import { useStorageUrl } from "@/lib/storage";

/** Фото сотрудника справочника (бакет trainer-photos), без фото — инициалы. */
export function EmployeePhoto({
  value,
  name,
  className,
}: {
  value: string | null;
  name: string;
  className?: string;
}) {
  const src = useStorageUrl("trainers", value);
  return (
    <Avatar className={className}>
      {src && <AvatarImage src={src} alt={name} />}
      <AvatarFallback>{initials(name)}</AvatarFallback>
    </Avatar>
  );
}

/** Аватарка учётной записи сотрудника (profiles.avatar_url, бакет avatars), без неё — инициалы. */
export function StaffAvatar({
  value,
  name,
  className,
}: {
  value: string | null | undefined;
  name: string;
  className?: string;
}) {
  const src = useStorageUrl("avatars", value);
  return (
    <Avatar className={className}>
      {src && <AvatarImage src={src} alt={name} />}
      <AvatarFallback>{initials(name)}</AvatarFallback>
    </Avatar>
  );
}

/**
 * Сотрудник в выпадающем списке — аватарка и имя (решение владельца
 * 2026-10-11: во всех списках сотрудников админки, так проще найти глазами).
 * `photo` — фото из справочника «Сотрудники» (trainers.photo_url); у учётных
 * записей админки (касса) — `avatar` (profiles.avatar_url). Видно и в
 * закрытом поле: SelectValue повторяет содержимое пункта.
 */
export function StaffOption({
  name,
  photo,
  avatar,
  children,
}: {
  name: string;
  photo?: string | null;
  avatar?: string | null;
  /** Подпись вместо имени (например, «Имя (вы)»). */
  children?: React.ReactNode;
}) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      {avatar !== undefined ? (
        <StaffAvatar value={avatar} name={name} className="size-5 shrink-0 text-[9px]" />
      ) : (
        <EmployeePhoto value={photo ?? null} name={name} className="size-5 shrink-0 text-[9px]" />
      )}
      <span className="truncate">{children ?? name}</span>
    </span>
  );
}

export function TrainerRoleBadge({ role }: { role: TrainerRole }) {
  const r = TRAINER_ROLES[role] ?? TRAINER_ROLES.trainer;
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${r.badge}`}
    >
      {r.label}
    </span>
  );
}
