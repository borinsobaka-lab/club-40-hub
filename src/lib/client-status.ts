/**
 * Статус клуба (вычисляется из client_memberships):
 *  - chk  — Член клуба: есть активный абонемент (status='active' и не истёк).
 *  - bchk — Бывший член клуба: когда-то был абонемент, сейчас нет активного.
 *  - pchk — Потенциальный член клуба: никогда не покупал абонементы.
 */
export type ClubStatus = "chk" | "pchk" | "bchk";

export const CLUB_STATUS_LABEL: Record<ClubStatus, string> = {
  chk: "ЧК",
  pchk: "ПЧК",
  bchk: "БЧК",
};

export const CLUB_STATUS_FULL: Record<ClubStatus, string> = {
  chk: "Член клуба",
  pchk: "Потенциальный член клуба",
  bchk: "Бывший член клуба",
};

export type MembershipLite = {
  client_id: string;
  status: string | null;
  ends_at: string | null;
};

function todayISO() {
  const d = new Date();
  const tz = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tz).toISOString().slice(0, 10);
}

export function computeClubStatus(memberships: MembershipLite[] | null | undefined): ClubStatus {
  const list = memberships ?? [];
  if (list.length === 0) return "pchk";
  const today = todayISO();
  const hasActive = list.some((m) => m.status === "active" && (!m.ends_at || m.ends_at >= today));
  if (hasActive) return "chk";
  return "bchk";
}
