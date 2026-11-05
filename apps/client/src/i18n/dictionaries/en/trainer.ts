import type { Dictionary } from "../types";

/** Раздел: тренер в приложении — «Моё расписание», записанные, анкета клиента, комментарии тренеров. */
const dict: Dictionary = {
  "Информация для тренера": "For the trainer",
  "О тренировке": "About the class",
  "сегодня {time}": "today {time}",
  "вчера {time}": "yesterday {time}",
  Клиент: "Client",
  "Не удалось загрузить анкету клиента.": "Couldn't load the client's questionnaire.",
  "Клиент ещё не заполнил анкету в приложении.":
    "The client hasn't filled in the questionnaire in the app yet.",
  "Главная цель": "Main goal",
  Мотивация: "Motivation",
  "Желаемая частота": "Desired frequency",
  "4 и больше раз в неделю": "4 or more times a week",
  "Опыт тренировок": "Training experience",
  "Текущая активность": "Current activity",
  "{n} кг": "{n} kg",
  "Ограничения по здоровью": "Health restrictions",
  "Ограничений по здоровью в анкете нет.": "No health restrictions in the questionnaire.",
  Анкета: "Questionnaire",
  "Комментарий сохранён": "Comment saved",
  "Комментарии тренеров": "Trainer comments",
  "Что важно знать другим тренерам о клиенте": "What other trainers should know about the client",
  "Добавить комментарий": "Add comment",
  "Комментариев пока нет.": "No comments yet.",
  "{n} раз в неделю|{n} раза в неделю|{n} раз в неделю": "{n} time a week|{n} times a week",
  "{n} комментарий|{n} комментария|{n} комментариев": "{n} comment|{n} comments",
  "Моё расписание": "My schedule",
  "Не удалось загрузить ваше расписание. Обновите страницу.":
    "Couldn't load your schedule. Refresh the page.",
  "Ближайших тренировок в расписании нет": "No upcoming classes in your schedule",
  "Показать ещё": "Show more",
  "Не удалось загрузить список записанных.": "Couldn't load the list of attendees.",
  "На тренировку пока никто не записан.": "Nobody has booked this class yet.",
  Пробное: "Trial",
  Ограничения: "Restrictions",
  "Цель: {goal}": "Goal: {goal}",
  "+ Комментарий": "+ Comment",
  "Записан {n} человек|Записано {n} человека|Записано {n} человек":
    "{n} person booked|{n} people booked",
  "{n} на пробном|{n} на пробном|{n} на пробном": "{n} on a trial|{n} on a trial",
};

export default dict;
