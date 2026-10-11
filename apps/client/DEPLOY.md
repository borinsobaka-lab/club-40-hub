# Инструкция для агента: деплой клиентского приложения на app.base40.fit

Ты — агент, работающий в браузере от имени владельца. Инфраструктура уже существует
(сервер Hetzner `club40-coolify`, панель https://coolify.base40.fit, DNS-запись
`app.base40.fit` → 62.238.104.251 создана). Твоя задача — развернуть на ней ВТОРОЕ
приложение: клиентское, из монорепозитория `borinsobaka-lab/club-40-hub`
(папка `apps/client`; до 2026-10-10 — отдельный репозиторий `club40-client-hub`,
переключение существующих ресурсов — AGENT_TASKS.md, Задача 9).

Ничего не удаляй и не меняй в уже работающем приложении `club40-admin`.

## Шаг 1. Доступ GitHub App к репозиторию

GitHub App **club40-github** (App ID 4507927) уже имеет доступ к
`club-40-hub` — через него деплоится админка. Ничего делать не нужно.

## Шаг 2. Создать приложение в Coolify

1. https://coolify.base40.fit → проект **club40** → окружение **production** →
   **+ New Resource** → **Private Repository (with GitHub App)** → источник
   **club40-github** → репозиторий `borinsobaka-lab/club-40-hub`, ветка `main`.
2. Настройки:
   - **Имя ресурса**: `club40-client`
   - **Build Pack**: Dockerfile; **Base Directory**: `/`; **Dockerfile
     Location**: `/apps/client/Dockerfile`
   - **Watch Paths**: `apps/client/**` (иначе приложение пересобирается и от
     правок админки)
   - **Port**: 3000
   - **Domain**: `https://app.base40.fit`, Force HTTPS включить
   - **Auto Deploy**: включить (пуш в `main` разворачивается автоматически)

## Шаг 3. Переменные окружения

Обе — публичные, и обе нужны **на этапе сборки**: отметь у каждой галочку
**Build Variable** (Runtime можно оставить включённым тоже).

| Имя                             | Значение                                                  |
| ------------------------------- | --------------------------------------------------------- |
| `VITE_SUPABASE_URL`             | `https://api.base40.fit`                                  |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | значение из файла `apps/client/.env` (anon-ключ `eyJ...`) |

Supabase — self-hosted в Coolify (API `https://api.base40.fit`); облачный проект
`lyvarbqquvgxufmqgyix` больше не используется. Переменную
`VITE_SUPABASE_PROJECT_ID`, если она осталась в Coolify, можно удалить — код её
не читает.

Секретных ключей (`service_role`) этому приложению НЕ нужно — не добавляй их.

## Шаг 4. Деплой

Нажми **Deploy**, дождись успешной сборки (ориентир по админке — меньше минуты).
Проверь, что `https://app.base40.fit` открывается и показывает экран входа Base40.

## Шаг 5. Supabase

Self-hosted Supabase настраивается переменными сервиса **auth** (GoTrue) в
Coolify (ресурс Supabase на coolify.base40.fit), а не через Dashboard:

- `GOTRUE_URI_ALLOW_LIST` (в шаблоне Coolify — `ADDITIONAL_REDIRECT_URLS`)
  должен содержать `https://app.base40.fit/**`.
- `GOTRUE_SITE_URL` указывает на админку — это правильно: клиентское
  приложение передаёт свой адрес явно при входе.

## Шаг 6. Смоук-тест (без входа в аккаунт)

1. `https://app.base40.fit` открывается, сертификат валиден.
2. Экран входа отрисовывается, шрифты и стили на месте.
3. В DevTools → Network нет запросов к `*.supabase.co` (облачные проекты
   `nmeefwuetncpxgufwelj` и `lyvarbqquvgxufmqgyix` больше не используются; все
   запросы должны идти на `api.base40.fit`).
4. Нет запросов к доменам lovable.dev / lovable.app.

Проверки, требующие входа, выполнит владелец: вход, расписание и запись на
тренировку, покупка/просмотр абонемента, профиль и статистика, новости, аватарка.

## Шаг 7. Отчёт владельцу

- Адрес приложения, статус деплоя, время сборки.
- Скриншот или перечень пройденных пунктов смоук-теста.
- Что НЕ делалось: Lovable не трогали (отключается отдельной командой владельца,
  как и для админки — см. шаг 9 в INFRA_SETUP.md в корне репозитория).

---

# Второе приложение: «Зал с пакетами тренировок» (с 2026-10-09)

Студии делятся на два формата (STUDIO_FORMATS.md в корне репозитория). У каждого формата своё клиентское приложение: **та же
кодовая база и тот же репозиторий**, отличие — build-переменная
`VITE_APP_FORMAT`. Существующее `club40-client` (app.base40.fit) — подписочный
формат, его НЕ трогаем.

Адрес нового приложения — `pack.base40.fit` (предварительный; если владелец
выберет другой — поменять в `apps/client/src/lib/app-format.ts` и в
`apps/admin/src/lib/studio-formats.ts`).

1. **DNS**: A-запись `pack.base40.fit` → 62.238.104.251 (как у app.base40.fit).
2. **Coolify** → проект **club40** → **production** → **+ New Resource** →
   Private Repository (with GitHub App) → `borinsobaka-lab/club-40-hub`,
   ветка `main`. Настройки как в Шаге 2 выше, но:
   - **Имя ресурса**: `club40-client-packages`
   - **Domain**: `https://pack.base40.fit`
3. **Переменные** (все три — **Build Variable**): `VITE_SUPABASE_URL` и
   `VITE_SUPABASE_PUBLISHABLE_KEY` — те же, что у `club40-client`, плюс
   `VITE_APP_FORMAT` = `packages`.
4. **Supabase (auth)**: в `GOTRUE_URI_ALLOW_LIST` (`ADDITIONAL_REDIRECT_URLS`)
   добавить `https://pack.base40.fit/**` через запятую к существующим, затем
   Restart сервиса auth. Письма новому приложению уходят с кодом
   автоматически (код — всё, что не admin.base40.fit).
5. **Деплой и проверка**: экран входа открывается. Регистрация заработает,
   когда в админке («Доступы → Студии») будет заведена студия типа «Зал с
   пакетами тренировок» — до этого форма отвечает «Регистрация пока закрыта».
