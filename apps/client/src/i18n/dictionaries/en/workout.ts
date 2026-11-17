import type { Dictionary } from "../types";

/** Раздел: шторка тренировки (запись, отмена, календарь), типы тренировок. */
const dict: Dictionary = {
  "{n} мин": "{n} min",
  "Google Календарь": "Google Calendar",
  "Apple Календарь": "Apple Calendar",
  "Другой (.ics файл)": "Other (.ics file)",
  "Вы в листе ожидания. Освободится место — пришлём уведомление: запишется тот, кто успеет первым.":
    "You're on the waitlist. If a spot opens up, we'll send you a notification — first to book gets it.",
  "Место освободилось — успейте записаться, пока его не занял кто-то другой.":
    "A spot has opened up — book it before someone else does.",
  "Тренировку можно отменить не позже чем за {time} до начала":
    "You can cancel no later than {time} before the workout starts",
  "Отменить запись": "Cancel booking",
  "В календарь": "Add to calendar",
  "Выйти из очереди": "Leave waitlist",
  "Встать в очередь": "Join waitlist",
  Записаться: "Book",
  "Выберите календарь": "Choose a calendar",
  Тренер: "Trainer",
  "Рейтинг {value} из 5": "Rated {value} out of 5",
  Занятие: "Class",
  Кардио: "Cardio",
  Силовая: "Strength",
  Гибрид: "Hybrid",
  Восстановление: "Recovery",
  Тренировка: "Workout",
  "Отменить запись?": "Cancel this booking?",
  "Не отменять": "Keep booking",
  "Хотите выбрать другое время для тренировки?":
    "Would you like to pick another time for your workout?",
  "Не сейчас": "Not now",
  "Выбрать время": "Pick a time",
};

export default dict;
