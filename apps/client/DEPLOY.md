# Инструкция для агента: деплой клиентского приложения на app.base40.fit

Ты — агент, работающий в браузере от имени владельца. Инфраструктура уже существует
(сервер Hetzner `club40-coolify`, панель https://coolify.base40.fit, DNS-запись
`app.base40.fit` → 62.238.104.251 создана). Твоя задача — развернуть на ней ВТОРОЕ
приложение: клиентское, из репозитория `borinsobaka-lab/club40-client-hub`.

Ничего не удаляй и не меняй в уже работающем приложении `club40-admin`.

## Шаг 1. Дать GitHub App доступ ко второму репозиторию

GitHub App **club40-github** (App ID 4507927) сейчас, скорее всего, имеет доступ
только к `club-40-hub`.

1. Зайди на GitHub под `borinsobaka-lab` → аватар → **Settings** → **Applications**
   → вкладка **Installed GitHub Apps** → **club40-github** → **Configure**.
2. В **Repository access**: если стоит "Only select repositories" — добавь
   `club40-client-hub` и сохрани. Если "All repositories" — ничего делать не нужно.

## Шаг 2. Создать приложение в Coolify

1. https://coolify.base40.fit → проект **club40** → окружение **production** →
   **+ New Resource** → **Private Repository (with GitHub App)** → источник
   **club40-github** → репозиторий `borinsobaka-lab/club40-client-hub`, ветка `main`.
2. Настройки:
   - **Имя ресурса**: `club40-client`
   - **Build Pack**: Dockerfile (файл `/Dockerfile` в корне репозитория)
   - **Port**: 3000
   - **Domain**: `https://app.base40.fit`, Force HTTPS включить
   - **Auto Deploy**: включить (пуш в `main` разворачивается автоматически)

## Шаг 3. Переменные окружения

Все три — публичные, и все три нужны **на этапе сборки**: отметь у каждой галочку
**Build Variable** (Runtime можно оставить включённым тоже).

| Имя | Значение |
|---|---|
| `VITE_SUPABASE_PROJECT_ID` | `lyvarbqquvgxufmqgyix` |
| `VITE_SUPABASE_URL` | `https://lyvarbqquvgxufmqgyix.supabase.co` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | значение из файла `.env` в корне репозитория (начинается с `sb_publishable_`) |

Секретных ключей (`service_role`) этому приложению НЕ нужно — не добавляй их.

## Шаг 4. Деплой

Нажми **Deploy**, дождись успешной сборки (ориентир по админке — меньше минуты).
Проверь, что `https://app.base40.fit` открывается и показывает экран входа CLUB 40.

## Шаг 5. Supabase

Dashboard проекта `lyvarbqquvgxufmqgyix` → **Authentication → URL Configuration**:

- В **Redirect URLs** добавь `https://app.base40.fit/**`.
- **Site URL не меняй** — он указывает на админку, и это сейчас правильно:
  клиентское приложение передаёт свой адрес явно при регистрации.
- Старые lovable-адреса не удаляй.

## Шаг 6. Смоук-тест (без входа в аккаунт)

1. `https://app.base40.fit` открывается, сертификат валиден.
2. Экран входа отрисовывается, шрифты и стили на месте.
3. В DevTools → Network нет запросов к `nmeefwuetncpxgufwelj.supabase.co`
   (это мёртвый проект; все запросы должны идти на `lyvarbqquvgxufmqgyix.supabase.co`).
4. Нет запросов к доменам lovable.dev / lovable.app.

Проверки, требующие входа, выполнит владелец: вход, расписание и запись на
тренировку, покупка/просмотр абонемента, профиль и статистика, новости, аватарка.

## Шаг 7. Отчёт владельцу

- Адрес приложения, статус деплоя, время сборки.
- Скриншот или перечень пройденных пунктов смоук-теста.
- Что НЕ делалось: Lovable не трогали (отключается отдельной командой владельца,
  как и для админки — см. шаг 9 в INFRA_SETUP.md репозитория club-40-hub).
