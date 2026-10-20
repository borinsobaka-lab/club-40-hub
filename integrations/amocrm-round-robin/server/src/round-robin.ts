/**
 * Очередь ответственных. Храним не только номер места в очереди, но и кто
 * получил последнюю сделку: если список в настройках поменяли (кого-то
 * добавили, убрали, переставили), очередь продолжается со следующего после
 * этого человека, а не прыгает.
 */
export interface QueueState {
  lastUserId: number | null;
  /** Место в списке, куда попала последняя сделка. */
  lastIndex: number;
}

export function pickNext(
  users: readonly number[],
  state: QueueState | null,
): { userId: number; state: QueueState } | null {
  if (users.length === 0) return null;
  let index = 0;
  if (state) {
    const pos = state.lastUserId == null ? -1 : users.indexOf(state.lastUserId);
    // Последний ещё в списке — следующий за ним. Убрали из списка — на его
    // место встал следующий, ему и отдаём.
    index = pos >= 0 ? pos + 1 : state.lastIndex;
  }
  index %= users.length;
  const userId = users[index];
  return { userId, state: { lastUserId: userId, lastIndex: index } };
}
