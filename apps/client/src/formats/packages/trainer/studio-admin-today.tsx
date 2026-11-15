import { useQuery } from "@tanstack/react-query";
import { Plain } from "@solar-icons/react";

import {
  SquircleAvatar,
  SquircleAvatarFallback,
  SquircleAvatarImage,
} from "@/components/ui/squircle-avatar";
import { useAuth } from "@/hooks/use-auth";
import { useViewedStudioId } from "@/hooks/use-viewed-studio";
import { useLocalize, useT } from "@/i18n";
import { mediaUrl } from "@/lib/media";
import { trainerInitials } from "../entries";
import { telegramHref } from "./format";
import { studioAdminsTodayQuery, trainerMeQuery, type StudioAdminToday } from "./queries";

/**
 * Кто сегодня администратор в выбранной студии — только тренеру, на главной
 * под плашкой студии (решение владельца 2026-11-15): та же плашка, фото и
 * имя администратора из «Графика» админки на сегодня; нажатие открывает его
 * Telegram. Без Telegram — плашка без перехода; смены нет — плашки нет.
 */
export function StudioAdminToday() {
  const { user } = useAuth();
  const { studioId } = useViewedStudioId();
  const { data: me } = useQuery(trainerMeQuery(user?.id ?? null));
  const { data: admins = [] } = useQuery(studioAdminsTodayQuery(studioId, !!me));
  if (!me || admins.length === 0) return null;
  return (
    <div className="mt-2 space-y-2">
      {admins.map((a) => (
        <AdminRow key={a.trainer_id} admin={a} />
      ))}
    </div>
  );
}

function AdminRow({ admin }: { admin: StudioAdminToday }) {
  const t = useT();
  const loc = useLocalize();
  const name = loc(admin).full_name ?? "";
  const photo = mediaUrl(admin.photo_url, "trainer-photos");
  const href = telegramHref(admin.telegram);
  const body = (
    <>
      <SquircleAvatar size={36} className="shrink-0">
        {photo && <SquircleAvatarImage src={photo} alt={name} />}
        <SquircleAvatarFallback className="bg-white/20 text-xs font-semibold text-white">
          {trainerInitials(name)}
        </SquircleAvatarFallback>
      </SquircleAvatar>
      <span className="min-w-0 flex-1">
        <span className="block text-xs leading-tight text-white/70">
          {t("Администратор сегодня")}
        </span>
        <span className="block truncate text-sm font-semibold leading-tight text-white">
          {name}
        </span>
      </span>
      {href && (
        <span className="flex shrink-0 items-center gap-1 text-xs font-semibold text-white/80">
          {t("Написать")}
          <Plain className="h-4 w-4" />
        </span>
      )}
    </>
  );
  const cls = "flex w-full items-center gap-3 rounded-2xl bg-white/10 px-3 py-2 text-left";
  return href ? (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={`${cls} transition active:scale-[0.99]`}
    >
      {body}
    </a>
  ) : (
    <div className={cls}>{body}</div>
  );
}
