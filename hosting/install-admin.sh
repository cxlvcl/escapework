#!/usr/bin/env bash
set -euo pipefail
bundle=$(cd -- "$(dirname -- "$0")" && pwd)
private=/var/www/u3638340/data/escape-private
public=/var/www/u3638340/data/www/escapeworkspaceru.ru
php=/usr/bin/php
test -f "$private/config.php"
test -f "$public/index.html"
for file in mysql.php gateway.php mysql-admin.php admin-security.php admin-install.php; do
  "$php" -l "$bundle/escape-private/$file"
done
backup=$(mktemp -d "$private/admin-backup-XXXXXX")
mkdir "$backup/private"
for file in mysql.php gateway.php mysql-admin.php admin-security.php admin-install.php admin-schema.sql admin.ready; do
  if test -f "$private/$file"; then cp -p "$private/$file" "$backup/private/$file"; fi
done
tar -cf "$backup/www.before.tar" -C "$public" .
cp "$bundle/rollback-admin.sh" "$backup/rollback-admin.sh"
echo "Резервная копия: $backup"
# Install dependencies before either live entry point can require them.
for file in mysql-admin.php admin-security.php admin-install.php admin-schema.sql mysql.php gateway.php; do
  install -m 644 "$bundle/escape-private/$file" "$private/$file.admin-new"
  mv -f "$private/$file.admin-new" "$private/$file"
done
install -d -m 755 "$public/assets" "$public/icons" "$public/admin"
install -m 644 "$bundle"/www/assets/* "$public/assets/"
install -m 644 "$bundle"/www/icons/* "$public/icons/"
for file in admin.js admin.css index.html .htaccess; do
  install -m 644 "$bundle/www/admin/$file" "$public/admin/$file.admin-new"
  mv -f "$public/admin/$file.admin-new" "$public/admin/$file"
done
for file in manifest.json apple-touch-icon.png favicon-32.png index.html; do
  install -m 644 "$bundle/www/$file" "$public/$file.admin-new"
  mv -f "$public/$file.admin-new" "$public/$file"
done
echo "Файлы установлены. Резервные копии: $backup"
echo "Следующий отдельный шаг: /usr/bin/php $private/admin-install.php"
