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
