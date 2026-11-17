> **REG.RU Host-0 (PHP):** актуальная инструкция — [hosting/README.md](hosting/README.md). Разделы Next.js ниже относятся к исходному варианту. Перед публикацией пользователь просматривает локальный тест на http://localhost:3102.

# Пошаговая настройка Google backend для ESCAPE

Supabase больше не нужен. Данные — Google Sheets, фотографии — Google Drive, бизнес-логика — Apps Script. Next.js можно оставить на Vercel или другом Node-хостинге. Ниже — настройка с Vercel.

## 1. Подготовьте файлы

В терминале проекта (Node 22.12+):

```sh
npm ci
npm run google:build
```

Созданы `google/dist/Code.js` и `google/dist/appsscript.json`. Это готовые файлы для загрузки в Apps Script; не копируйте TypeScript из `google/src` напрямую.

Локальный `.env` уже содержит данные первого су-шефа Артема и сгенерированные `GOOGLE_API_SECRET`/`CRON_SECRET`. Пароли не находятся в исходниках. Не заменяйте существующий `.env` пустым шаблоном.

## 2. Создайте таблицу Google

1. Откройте https://sheets.google.com и создайте пустую таблицу `ESCAPE Checklist`.
2. Оставьте доступ **Ограниченный / Restricted**.
3. Скопируйте ID из адреса `https://docs.google.com/spreadsheets/d/ID/edit`.
4. Сохраните его для свойства `SPREADSHEET_ID`.

Не создавайте листы вручную: это сделает `setupDatabase()`. Новые роли, комментарии, персональные прохождения и issues создавать не нужно.

## 3. Создайте папку фото

1. В https://drive.google.com создайте отдельную папку `ESCAPE Checklist Photos`.
2. Доступ — **Ограниченный / Restricted**; не включайте доступ всем по ссылке.
3. Скопируйте ID из URL `https://drive.google.com/drive/folders/ID`.
4. Это `PHOTO_FOLDER_ID`. Для простой настройки используйте личный My Drive владельца скрипта, без наследуемого общего доступа.

Поваров не надо приглашать в папку. Приложение выдаёт фото после проверки роли и сессии. PNG логотипа остаётся в Next.js.

## 4. Создайте Apps Script

1. Откройте https://script.google.com и нажмите **New project**.
2. Назовите проект `ESCAPE Backend`.
3. В редакторе откройте `Code.gs` и замените его содержимым **`google/dist/Code.js`**.
4. В **Project Settings** включите показ manifest `appsscript.json`.
5. Замените manifest содержимым `google/dist/appsscript.json`.
6. Убедитесь, что в **Services** доступен **Google Sheets API v4** с идентификатором `Sheets`. Если его нет, нажмите `+` и добавьте. При использовании стандартного Google Cloud project может потребоваться отдельно включить Google Sheets API в Cloud Console.

Manifest задаёт timezone `Europe/Moscow` и необходимые доступы к Sheets и Drive. [Advanced services Apps Script](https://developers.google.com/apps-script/guides/services/advanced).

## 5. Заполните Script Properties

Apps Script → **Project Settings → Script Properties → Add script property**:

| Property | Value |
| --- | --- |
| `SPREADSHEET_ID` | ID таблицы из шага 2 |
| `PHOTO_FOLDER_ID` | ID закрытой папки из шага 3 |
| `GOOGLE_API_SECRET` | Значение из локального `.env`; минимум 32 случайных символа |
| `BOOTSTRAP_ENABLED` | `true`, только до создания первого су-шефа |

Не помещайте ID или секреты в `Code.gs`. Один владелец скрипта должен иметь доступ к таблице и папке.

## 6. Создайте структуру и фиксированные данные

1. В выпадающем списке функций выберите **setupDatabase**.
2. Нажмите **Run** и предоставьте вашему скрипту запрошенные права Google.
3. Дождитесь успешного выполнения.
4. Откройте Spreadsheet: должны появиться 15 листов (12 предметных и 3 технических).

Seed создаёт ровно 9 станций, 31 задачу станции, 32 холодильника и 96 задач холодильников. `additional_task_types` содержит 10 утверждённых типов. Повторный запуск сохраняет существующие записи, не сбрасывает изменённые задачи и не дублирует seed. Известные заголовки предыдущей Google-версии обновляются безопасной миграцией; неизвестная схема останавливает настройку.

## 7. Опубликуйте Apps Script Web App

1. **Deploy → New deployment**.
2. Тип — **Web app**.
3. **Execute as — Me** (владелец скрипта).
4. **Who has access — Anyone**: сервер Next должен обращаться без Google OAuth. Доступ к данным всё равно защищён HMAC-подписью и пользовательской сессией; неподписанный POST отклоняется.
5. Нажмите **Deploy**.
6. Скопируйте адрес вида `https://script.google.com/macros/s/.../exec`.
7. В локальном `.env` задайте `GOOGLE_API_URL=этот_адрес`.

Нужен URL **`/exec`**, не `/dev` и не адрес редактора. Если организация Google Workspace запрещает Anyone, администратор должен разрешить такой deployment; обхода ограничений в коде нет. [Web Apps](https://developers.google.com/apps-script/guides/web).

При последующем обновлении кода: пересоберите bundle, скопируйте в редактор, затем **Deploy → Manage deployments → Edit → New version → Deploy**. Простое Save не обновляет опубликованную версию.

## 8. Создайте первого су-шефа Артема

В локальном терминале:

```sh
npm run bootstrap
```

Команда читает имя/логин/пароль из `.env`, вычисляет salted scrypt hash и отправляет подписанный запрос в Apps Script. Пароль открытым текстом в Sheets не сохраняется. Ожидаемый результат — «Первый су-шеф создан в Google Sheets».

При успехе Script Property `BOOTSTRAP_ENABLED` удаляется автоматически. Если су-шеф уже существует, аккаунт не изменяется. Удалите три `BOOTSTRAP_SOUS_CHEF_*` строки из локального `.env` после облачного создания (они нужны только bootstrap и явному локальному preview).

Авторизация приложения остаётся по логину/паролю, роли: Повар / Су-шеф / Шеф-повар / Аудит. Су-шеф создаёт новые аккаунты и выбирает одну из этих ролей.

## 9. Проверьте облачное подключение локально

```sh
npm run dev
```

Откройте http://localhost:3000. Войдите как **Артем** с заданным паролем. Проверьте список станций, создание аккаунта с выбором роли, вход повара, смену и выполнение с фото. Под су-шефом откройте фото. Убедитесь, что запись появилась в Sheets, а файл — в закрытой папке Drive.

`npm run preview` проверяет только локальный адаптер без Google. Для реальной проверки Google используйте `npm run dev` с опубликованным `GOOGLE_API_URL`.

## 10. Разместите Next.js на Vercel

1. Сохраните исходники в private GitHub-репозитории, исключив `.env`, `.env.local`, `.next`, `node_modules`, `test-results`. `.env.example` можно публиковать.
2. В https://vercel.com/new импортируйте репозиторий.
3. Framework — Next.js, Node — 22.x, Build — `npm run build`, корень проекта — корень репозитория.
4. В **Settings → Environment Variables**, Production, задайте:

| Name | Value |
| --- | --- |
| `GOOGLE_API_URL` | Web App URL `/exec` |
| `GOOGLE_API_SECRET` | То же значение, что в Script Properties |
| `CRON_SECRET` | Значение из локального `.env` |

Bootstrap-пароль на Vercel не нужен. Переменные не имеют префикса `NEXT_PUBLIC_`. Supabase/Database/Auth secret переменные прежней версии удалите из конфигурации старого проекта, если добавляли. После изменения env выполните redeploy. [Vercel environment variables](https://vercel.com/docs/environment-variables).

5. Нажмите Deploy и откройте HTTPS URL. Снова проверьте роли и фото.

## 11. Настройте Google Cloud Scheduler на 04:00 МСК

Обычный Apps Script time trigger имеет временной разброс, поэтому для требуемого расписания используем **Google Cloud Scheduler**. Он вызывает защищённый маршрут Next, который передаёт команду в Apps Script. Статистика считается и хранится в Google.

1. Откройте https://console.cloud.google.com, создайте/выберите Cloud project.
2. Подключите billing, если Cloud Console потребует, и включите **Cloud Scheduler API**. Условия оплаты проверьте в своём аккаунте перед подключением.
3. Cloud Scheduler → **Create job**.
4. Имя `escape-daily-snapshot`, подходящий регион.
5. Frequency: **`0 4 * * *`**.
6. Timezone: **`Europe/Moscow`**.
7. Target type: HTTP, URL **`https://ВАШ-ДОМЕН/api/cron`**, метод **POST**.
8. Header: `Authorization` со значением `Bearer ` + ваш `CRON_SECRET`. Body: `{}`; Content-Type: `application/json`.
9. Встроенную OIDC/OAuth аутентификацию для этого публичного Next endpoint не добавляйте — он проверяет указанный Bearer secret.
10. Если Vercel Deployment Protection закрывает Production URL, настройте доступ Scheduler к нему; не направляйте job на закрытый Preview deployment.
11. Сохраните job. После 04:00 МСК нажмите **Force run / Run now** для проверки.

Успешный вызов заполняет `daily_statistics` и `daily_station_statistics` за вчерашний московский день. Повторный вызов не меняет snapshot. До 04:00 текущая рабочая дата ещё открыта: повторный запуск может фиксировать только более ранние закрытые дни. Рабочая дата и задания меняются в 04:00 МСК; ночные выполнения до этого времени остаются в прежнем дне.

Расписание назначено на 04:00; фактическая доставка может задерживаться, как у любого облачного scheduler. Пропущенные итоги за последние 32 дня восстанавливаются из истории заданий и выполнений при следующем запуске или открытии статистики; сохранённые итоги не пересчитываются. Следите за job logs и Apps Script Executions. [Cloud Scheduler: cron/timezone](https://docs.cloud.google.com/scheduler/docs/configuring/cron-job-schedules), [Apps Script: разброс time triggers](https://developers.google.com/apps-script/reference/script/clock-trigger-builder).

## 12. Итоговая проверка

- У Артема отображается выбор четырёх ролей при создании аккаунта.
- Созданный шеф-повар имеет read-only интерфейс; повар не управляет аккаунтами.
- Два повара одной станции видят общий completion и обновление без повторного входа.
- Без фото задача не закрывается; сохраняется только сжатый WebP.
- Drive folder остаётся Restricted, фото не выдаётся без сессии.
- Новый рабочий день начинается в 04:00 МСК; snapshot за вчера создаётся job в 04:00 МСК.
- Присутствуют 10 типов; су-шеф может добавить, изменить и скрыть тип.
- Су-шеф, шеф-повар и аудит открывают «Статистику активности»; повар доступа не имеет.

Google deployment/Spreadsheet/Drive пока не созданы агентом: их ID и доступ к Google не предоставлены. Подготовленные файлы и локальная проверка не заменяют этот последний cloud smoke-test.

Для уже работающей Google-версии: [порядок обновления без сброса данных](docs/GOOGLE_UPDATE.md).
