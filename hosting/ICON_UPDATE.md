# Иконка ESCAPE на главном экране телефона

Источник — присланный пользователем `IMG_9240.JPG`, сохранённый без изменений в `assets/app-icon-source.jpg`. Из него экспортируются квадратные PNG на белом фоне: 180 px для iPhone, 192/512 px для Android и 32 px для вкладки браузера. В варианте Android с маской добавлено белое поле, чтобы система не обрезала логотип и надпись.

Иконки и `manifest.json` подключены в обеих сборках: Next.js и PHP-хостинг. Команда `npm run icons:build` повторяет экспорт; `npm run build` и `npm run build:hosting` вызывают её автоматически.

## Шаг 1. Загрузить архив

Загрузите **`hosting/icon-update.zip`** с компьютера через «Менеджер файлов → escape-private» в ispmanager. На сервере должен появиться файл:

```text
/var/www/u3638340/data/escape-private/icon-update.zip
```

В архиве находятся `www/index.html`, `www/assets/`, `www/icons/`, `www/apple-touch-icon.png`, `www/favicon-32.png`, `www/manifest.json` и эта инструкция.

## Шаг 2. Установить

Вставьте блок в «Shell-клиент» и нажмите Enter:

```sh
icon_update=$(mktemp -d /var/www/u3638340/data/escape-private/icon-update-XXXXXX) &&
unzip -q /var/www/u3638340/data/escape-private/icon-update.zip -d "$icon_update" &&
tar -cf "$icon_update/www.before.tar" -C /var/www/u3638340/data/www/escapeworkspaceru.ru . &&
install -d -m 755 /var/www/u3638340/data/www/escapeworkspaceru.ru/icons &&
install -m 644 "$icon_update"/www/assets/* /var/www/u3638340/data/www/escapeworkspaceru.ru/assets/ &&
install -m 644 "$icon_update"/www/icons/* /var/www/u3638340/data/www/escapeworkspaceru.ru/icons/ &&
install -m 644 "$icon_update/www/manifest.json" "$icon_update/www/apple-touch-icon.png" "$icon_update/www/favicon-32.png" /var/www/u3638340/data/www/escapeworkspaceru.ru/ &&
chmod 644 "$icon_update/www/index.html" &&
mv -f "$icon_update/www/index.html" /var/www/u3638340/data/www/escapeworkspaceru.ru/index.html &&
echo "Иконка ESCAPE установлена. Резервная копия сайта: $icon_update/www.before.tar"
```

Архив прежних публичных файлов сохраняется в закрытом каталоге обновления. Страница переключается на новые файлы последней. Серверные PHP-файлы, база и CRON для этой установки не обновляются.

## Шаг 3. Проверить на телефоне

1. Откройте `https://escapeworkspaceru.ru/apple-touch-icon.png`: должен отображаться присланный логотип на белом фоне.
2. Откройте сам сайт в браузере телефона. На iPhone используйте Safari → «Поделиться» → «На экран Домой». Если есть переключатель «Открывать как веб-приложение», включите его. На Android используйте меню Chrome → «Добавить на главный экран» / «Установить приложение».
3. Проверьте логотип, название **ESCAPE** и вход в приложение через новую иконку. Если старая иконка осталась прежней, пересоздайте ярлык через браузер.

Добавление на главный экран описано в [руководстве Apple](https://support.apple.com/guide/iphone/open-as-web-app-iphea86e5236/ios). Реальную иконку на домашнем экране нужно проверить на телефоне после установки обновления.
