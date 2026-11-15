-- «О нас» приложения Lady Stretch: специалистов теперь 26 (решение
-- владельца 2026-11-15, было 18). Дальше число правится в админке
-- («Мобильное приложение» → «О нас»).
update public.app_about_settings
  set specialists_count = 26
  where format = 'packages';
