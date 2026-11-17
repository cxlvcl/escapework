#!/usr/bin/env bash
set -euo pipefail
backup=$(cd -- "$(dirname -- "$0")" && pwd)
private=/var/www/u3638340/data/escape-private
public=/var/www/u3638340/data/www/escapeworkspaceru.ru
test -f "$backup/private/mysql.php"
test -f "$backup/private/gateway.php"
test -f "$backup/www.before.tar"
# Restore original entry points before removing their newly introduced dependencies.
for file in mysql.php gateway.php mysql-admin.php admin-security.php admin-install.php admin-schema.sql admin.ready; do
  if test -f "$backup/private/$file"; then
    cp -p "$backup/private/$file" "$private/$file.restore"
    mv -f "$private/$file.restore" "$private/$file"
  else
    rm -f "$private/$file"
  fi
done
tar -xf "$backup/www.before.tar" -C "$public"
echo "Прежние файлы восстановлены. Изменения записей MySQL этим действием не отменяются."
