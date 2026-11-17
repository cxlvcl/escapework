<?php
declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

function migrationEnv(string $path): array
{
    if (!is_file($path) || !is_readable($path)) {
        throw new RuntimeException('Файл .env не найден или недоступен для чтения.');
    }
    $values = [];
    foreach (file($path, FILE_IGNORE_NEW_LINES) ?: [] as $line) {
        if (!preg_match('/^([A-Z_]+)=(.*)$/D', trim($line), $match)) continue;
        $value = trim($match[2]);
        if (str_starts_with($value, '"')) {
            $value = json_decode($value, true, 512, JSON_THROW_ON_ERROR);
        } elseif (str_starts_with($value, "'")) {
            $value = substr($value, 1, -1);
        }
        if (is_string($value)) $values[$match[1]] = $value;
    }
    return $values;
}

function migrationSetting(array $values, string $name): string
{
    $value = getenv($name);
    if (!is_string($value) || $value === '') $value = $values[$name] ?? '';
    if ($value === '') throw new RuntimeException("В .env отсутствует {$name}.");
    return $value;
}

function migrationLength(string $value): int
{
    $length = preg_match_all('/./us', $value);
    if ($length === false) throw new RuntimeException('В выгрузке найден некорректный UTF-8.');
    return $length;
}

function migrationText(mixed $value, int $max, string $field): string
{
    if (!is_string($value) || $value === '' || migrationLength($value) > $max) {
        throw new RuntimeException("Некорректное поле {$field} в выгрузке.");
    }
    return $value;
}

function migrationUuid(mixed $value, string $field): string
{
    $value = migrationText($value, 36, $field);
    if (!preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iD', $value)) {
        throw new RuntimeException("Некорректный UUID в поле {$field}.");
    }
    return $value;
}

function migrationInteger(mixed $value, string $field, bool $unsigned = false): int
{
    if (is_float($value) && floor($value) === $value) $value = (int) $value;
    if (is_string($value) && preg_match('/^-?[0-9]+$/D', $value)) $value = (int) $value;
    if (!is_int($value) || ($unsigned && $value < 0)) {
        throw new RuntimeException("Некорректное число в поле {$field}.");
    }
    return $value;
}

function migrationBoolean(mixed $value, string $field): int
{
    if ($value === true || $value === 1 || $value === '1' || $value === 'TRUE') return 1;
    if ($value === false || $value === 0 || $value === '0' || $value === 'FALSE') return 0;
    throw new RuntimeException("Некорректное логическое поле {$field}.");
}

function migrationDate(mixed $value, string $field): string
{
    if (!is_string($value) || !preg_match('/^\d{4}-\d{2}-\d{2}$/D', $value)) {
        throw new RuntimeException("Некорректная дата в поле {$field}.");
    }
    $date = DateTimeImmutable::createFromFormat('!Y-m-d', $value);
    if (!$date || $date->format('Y-m-d') !== $value) {
        throw new RuntimeException("Несуществующая дата в поле {$field}.");
    }
    return $value;
}

function migrationTimestamp(mixed $value, string $field): string
{
    if (!is_string($value) || !preg_match('/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/D', $value)) {
        throw new RuntimeException("Некорректное время в поле {$field}.");
    }
    return $value;
}

function migrationValue(string $table, string $column, mixed $value): mixed
{
    $nullable = [
        'users.active_station_id', 'users.deleted_at',
        'station_tasks.inactive_work_date',
        'station_task_completions.completed_by_user_id',
        'refrigerator_task_completions.completed_by_user_id',
        'additional_tasks.photo_path', 'additional_tasks.completed_at',
        'additional_tasks.completed_by_user_id', 'additional_tasks.title_snapshot',
    ];
    $field = $table . '.' . $column;
    if ($value === null) {
        if (in_array($field, $nullable, true)) return null;
        throw new RuntimeException("Обязательное поле {$field} пустое.");
    }

    $uuidColumns = [
        'id', 'station_id', 'task_id', 'refrigerator_id', 'task_type_id',
        'additional_task_id', 'user_id', 'active_station_id', 'completed_by_user_id',
    ];
    if (in_array($column, $uuidColumns, true)) return migrationUuid($value, $field);
    if (in_array($column, ['work_date', 'created_work_date', 'inactive_work_date'], true)) return migrationDate($value, $field);
    if (in_array($column, ['completed_at', 'deleted_at'], true)) return migrationTimestamp($value, $field);
    if ($column === 'is_active') return migrationBoolean($value, $field);
    if (in_array($column, ['number', 'sort_order'], true)) return migrationInteger($value, $field);
    if (in_array($column, ['completed_tasks', 'total_tasks'], true)) return migrationInteger($value, $field, true);
    if ($column === 'role') {
        if (!is_string($value) || !in_array($value, ['cook', 'sous_chef', 'chef', 'audit'], true)) {
            throw new RuntimeException("Некорректная роль в поле {$field}.");
        }
        return $value;
    }
    if ($column === 'task_type') {
        if (!is_string($value) || !in_array($value, ['main', 'individual'], true)) {
            throw new RuntimeException("Некорректный тип задачи в поле {$field}.");
        }
        return $value;
    }
    if ($column === 'password_hash') {
        if (!is_string($value) || !preg_match('/^scrypt:[a-f0-9]{32}:[a-f0-9]{128}$/D', $value)) {
            throw new RuntimeException("Некорректный хеш пароля в поле {$field}.");
        }
        return $value;
    }
    if ($column === 'login') return migrationText($value, 80, $field);
    if ($column === 'name') return migrationText($value, $table === 'users' ? 100 : 300, $field);
    if (in_array($column, ['title', 'title_snapshot'], true)) return migrationText($value, 300, $field);
    if ($column === 'photo_path') return migrationText($value, 1024, $field);
    throw new RuntimeException("Неизвестное поле {$field}.");
}

function migrationInsert(PDO $pdo, string $table, array $columns, array $rows): int
{
    if (!$rows) return 0;
    $sql = 'INSERT INTO `' . $table . '` (`' . implode('`,`', $columns) . '`) VALUES ('
        . implode(',', array_fill(0, count($columns), '?')) . ')';
    $statement = $pdo->prepare($sql);
    foreach ($rows as $index => $row) {
        if (!is_array($row)) throw new RuntimeException("Строка {$index} таблицы {$table} имеет неверный формат.");
        $values = [];
        foreach ($columns as $column) {
            if (!array_key_exists($column, $row)) {
                throw new RuntimeException("В таблице {$table} отсутствует поле {$column}.");
            }
            $values[] = migrationValue($table, $column, $row[$column]);
        }
        $statement->execute($values);
    }
    return count($rows);
}

$columns = [
    'users' => ['id', 'name', 'login', 'password_hash', 'role', 'active_station_id', 'deleted_at'],
    'station_tasks' => ['id', 'station_id', 'title', 'task_type', 'sort_order', 'is_active', 'created_work_date', 'inactive_work_date'],
    'refrigerators' => ['id', 'number', 'station_id'],
    'refrigerator_tasks' => ['id', 'refrigerator_id', 'title', 'sort_order'],
    'station_task_completions' => ['id', 'task_id', 'work_date', 'photo_path', 'completed_at', 'completed_by_user_id'],
    'refrigerator_task_completions' => ['id', 'task_id', 'work_date', 'photo_path', 'completed_at', 'completed_by_user_id'],
    'additional_task_types' => ['id', 'title', 'is_active'],
    'additional_tasks' => ['id', 'task_type_id', 'work_date', 'photo_path', 'completed_at', 'completed_by_user_id', 'title_snapshot'],
    'additional_task_assignees' => ['additional_task_id', 'user_id'],
    'daily_statistics' => ['work_date', 'completed_tasks', 'total_tasks'],
    'daily_station_statistics' => ['work_date', 'station_id', 'completed_tasks', 'total_tasks'],
];
$googleTables = [
    'stations', 'users', 'station_tasks', 'station_task_completions',
    'refrigerators', 'refrigerator_tasks', 'refrigerator_task_completions',
    'additional_task_types', 'additional_tasks', 'additional_task_assignees',
    'daily_statistics', 'daily_station_statistics', 'sessions', 'login_attempts', 'operations',
];
$insertOrder = [
    'users', 'station_tasks', 'refrigerators', 'refrigerator_tasks',
    'station_task_completions', 'refrigerator_task_completions',
    'additional_task_types', 'additional_tasks', 'additional_task_assignees',
    'daily_statistics', 'daily_station_statistics',
];
$stationOrder = [
    'Горячий цех Греция', 'Холодный цех Греция', 'Пицца цех Греция',
    'Хоспер Греция', 'Raw Bar Греция', 'Горячий цех завтраки',
    'Холодный цех завтраки', 'Горячий цех Азия', 'Суши бар Азия',
];

try {
    $mode = $argv[1] ?? '';
    $filePath = $argv[2] ?? (__DIR__ . '/migration.json');
    if (!in_array($mode, ['--dry-run', '--commit'], true)) {
        throw new RuntimeException('Запуск: php import-mysql.php --dry-run|--commit [migration.json]');
    }
    if (!is_file($filePath) || !is_readable($filePath)) throw new RuntimeException('Файл migration.json не найден.');
    $size = filesize($filePath);
    if (!is_int($size) || $size < 2 || $size > 12 * 1024 * 1024) throw new RuntimeException('Некорректный размер migration.json.');
    $raw = file_get_contents($filePath);
    if (!is_string($raw)) throw new RuntimeException('Не удалось прочитать migration.json.');
    $document = json_decode($raw, true, 512, JSON_THROW_ON_ERROR);
    if (!is_array($document) || ($document['format'] ?? null) !== 'escape-mysql-v1' || ($document['frozen'] ?? null) !== true) {
        throw new RuntimeException('Это не финальная выгрузка ESCAPE для MySQL.');
    }
    if (!is_string($document['exportedAt'] ?? null) || !is_array($document['tables'] ?? null)) {
        throw new RuntimeException('Выгрузка имеет неверную структуру.');
    }
    $declaredHash = $document['sourceSha256'] ?? null;
    if (!is_string($declaredHash) || !preg_match('/^[a-f0-9]{64}$/D', $declaredHash)) {
        throw new RuntimeException('В выгрузке отсутствует контрольная сумма.');
    }
    $source = [
        'format' => $document['format'],
        'exportedAt' => $document['exportedAt'],
        'frozen' => $document['frozen'],
        'tables' => $document['tables'],
    ];
    $actualHash = hash('sha256', json_encode($source, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR));
    if (!hash_equals($declaredHash, $actualHash)) throw new RuntimeException('Контрольная сумма выгрузки не совпала.');
    foreach ($googleTables as $table) {
        if (!array_key_exists($table, $document['tables']) || !is_array($document['tables'][$table])) {
            throw new RuntimeException("В выгрузке отсутствует таблица {$table}.");
        }
    }
    foreach (['sessions', 'login_attempts', 'operations'] as $ephemeral) {
        if ($document['tables'][$ephemeral] !== []) throw new RuntimeException("Техническая таблица {$ephemeral} должна быть пустой.");
    }

    $env = migrationEnv(__DIR__ . '/.env');
    $pdo = new PDO(
        migrationSetting($env, 'DB_DSN'),
        migrationSetting($env, 'DB_USER'),
        migrationSetting($env, 'DB_PASSWORD'),
        [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_EMULATE_PREPARES => false],
    );
    $pdo->exec("SET time_zone = '+00:00'");
    $pdo->exec('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE');
    $pdo->beginTransaction();
    $pdo->query('SELECT id FROM app_mutex WHERE id = 1 FOR UPDATE')->fetchColumn();
    foreach (array_merge($googleTables, ['migration_receipt']) as $table) {
        if ((int) $pdo->query('SELECT COUNT(*) FROM `' . $table . '`')->fetchColumn() !== 0) {
            throw new RuntimeException("Таблица {$table} уже содержит данные; импорт остановлен.");
        }
    }

    $stationRows = [];
    foreach ($document['tables']['stations'] as $index => $row) {
        if (!is_array($row) || !array_key_exists('id', $row) || !array_key_exists('name', $row)) {
            throw new RuntimeException("Строка {$index} таблицы stations имеет неверный формат.");
        }
        $id = migrationUuid($row['id'], 'stations.id');
        $name = migrationText($row['name'], 300, 'stations.name');
        $position = array_search($name, $stationOrder, true);
        $stationRows[] = [$id, $name, $position === false ? 1000 + $index : $position];
    }
    $statement = $pdo->prepare('INSERT INTO stations (id,name,sort_order) VALUES (?,?,?)');
    foreach ($stationRows as $row) $statement->execute($row);

    $counts = ['stations' => count($stationRows)];
    foreach ($insertOrder as $table) {
        $counts[$table] = migrationInsert($pdo, $table, $columns[$table], $document['tables'][$table]);
    }
    $counts['sessions'] = 0;
    $counts['login_attempts'] = 0;
    $counts['operations'] = 0;
    $pdo->prepare('INSERT INTO migration_receipt (id,source_sha256,imported_at,counts_json) VALUES (1,?,?,?)')->execute([
        $declaredHash,
        gmdate('Y-m-d\TH:i:s') . '.000Z',
        json_encode($counts, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR),
    ]);

    if ($mode === '--commit') {
        $pdo->commit();
        echo "OK: данные перенесены в MySQL.\n";
    } else {
        $pdo->rollBack();
        echo "OK: пробный импорт прошёл, изменения отменены.\n";
    }
    foreach ($counts as $table => $count) echo "{$table}: {$count}\n";
} catch (PDOException $error) {
    if (isset($pdo) && $pdo instanceof PDO && $pdo->inTransaction()) $pdo->rollBack();
    $number = is_array($error->errorInfo ?? null) ? ($error->errorInfo[1] ?? null) : null;
    $suffix = is_int($number) ? " (код MySQL {$number})" : '';
    fwrite(STDERR, "ОШИБКА MySQL{$suffix}. Импорт отменён без частичных данных.\n");
    exit(1);
} catch (Throwable $error) {
    if (isset($pdo) && $pdo instanceof PDO && $pdo->inTransaction()) $pdo->rollBack();
    fwrite(STDERR, 'ОШИБКА: ' . $error->getMessage() . "\n");
    exit(1);
}
