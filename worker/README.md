# Сервер распознавания для ваучера

Принимает фото паспортов и скриншоты рейсов/отеля со страницы ваучера, отправляет их в Claude (`claude-opus-5-5`) и возвращает данные для заполнения.

## Первый запуск (один раз)

```bash
cd worker
npm install
npx wrangler login                          # вход в Cloudflare (бесплатный аккаунт)
npx wrangler secret put ANTHROPIC_API_KEY   # ключ с console.anthropic.com
npx wrangler secret put ACCESS_CODE         # любой придуманный пароль для страницы
npx wrangler deploy
```

После `deploy` будет адрес вида `https://leaf-voucher-ocr.<имя>.workers.dev`.
На странице ваучера: «📷 Заполнить из фото» → «⚙️ Настройки подключения» → вставить адрес и код доступа (запоминаются в браузере).

## Заметки
- Разрешённые сайты задаются в `ALLOWED_ORIGINS` в `wrangler.toml`.
- Данные паспортов нигде не сохраняются: воркер только пересылает их в Claude API.
- Если модель откажется обрабатывать запрос, включается автоматический запасной вариант (`fallbacks: "default"`).
