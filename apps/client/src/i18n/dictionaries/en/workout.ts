import type { Dictionary } from "../types";

/** Раздел: шторка тренировки (запись, отмена, календарь), типы тренировок. */
const dict: Dictionary = {
  "{n} мин": "{n} min",
  Другое: "Other",
  "Google Календарь": "Google Calendar",
  "Apple Календарь": "Apple Calendar",
  "Другой (.ics файл)": "Other (.ics file)",
  "Вы в листе ожидания. Если освободится место, с вами свяжется администратор.":
    "You're on the waitlist. If a spot opens up, the front desk will get in touch.",
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
  "Плохое самочувствие или болезнь": "Feeling unwell or sick",
  "Работа или учёба": "Work or studies",
  "Семейные обстоятельства": "Family matters",
  "Не успеваю к началу": "Can't make it in time",
  "Хочу перенести на другое время": "Want to move to another time",
  "Записался(-ась) по ошибке": "Booked by mistake",
  "Почему отменяете запись?": "Why are you cancelling?",
  "Выберите причину — так мы станем удобнее.": "Pick a reason — it helps us get better.",
  "Напишите причину": "Write the reason",
  "Не отменять": "Keep booking",
};

export default dict;
