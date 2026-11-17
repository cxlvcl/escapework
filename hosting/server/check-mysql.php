<?php
declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

function readPrivateEnv(string $path): array
{
    if (!is_file($path) || !is_readable($path)) {
        throw new RuntimeException('Файл .env не найден или недоступен для чтения.');
    }

    $values = [];
    foreach (file($path, FILE_IGNORE_NEW_LINES) ?: [] as $line) {
        if (!preg_match('/^([A-Z_]+)=(.*)$/D', trim($line), $match)) {
            continue;
        }
        $value = trim($match[2]);
        if (str_starts_with($value, '"')) {
            $value = json_decode($value, true, 512, JSON_THROW_ON_ERROR);
        } elseif (str_starts_with($value, "'")) {
            $value = substr($value, 1, -1);
        }
        if (is_string($value)) {
            $values[$match[1]] = $value;
        }
    }
    return $values;
}

function setting(array $values, string $name): string
{
    $value = getenv($name);
    if (!is_string($value) || $value === '') {
        $value = $values[$name] ?? '';
    }
    if ($value === '') {
        throw new RuntimeException("В .env отсутствует {$name}.");
    }
    return $value;
}

$expectedTables = [
    'additional_tasks',
    'additional_task_assignees',
    'additional_task_types',
    'app_mutex',
    'daily_station_statistics',
    'daily_statistics',
    'login_attempts',
    'migration_receipt',
    'operations',
    'refrigerators',
    'refrigerator_tasks',
    'refrigerator_task_completions',
    'sessions',
    'stations',
    'station_tasks',
    'station_task_completions',
    'users',
];

try {
    if (!extension_loaded('pdo_mysql')) {
        throw new RuntimeException('В PHP не включено расширение pdo_mysql.');
    }

    $env = readPrivateEnv(__DIR__ . '/.env');
    $pdo = new PDO(
        setting($env, 'DB_DSN'),
        setting($env, 'DB_USER'),
        setting($env, 'DB_PASSWORD'),
        [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_EMULATE_PREPARES => false,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        ],
    );
    $pdo->exec("SET time_zone = '+00:00'");

    $database = (string) $pdo->query('SELECT DATABASE()')->fetchColumn();
    $statement = $pdo->prepare(
        'SELECT table_name FROM information_schema.tables '
        . 'WHERE table_schema = DATABASE() AND table_name IN ('
        . implode(',', array_fill(0, count($expectedTables), '?'))
        . ') ORDER BY table_name',
    );
    $statement->execute($expectedTables);
    $actualTables = $statement->fetchAll(PDO::FETCH_COLUMN);
    $missing = array_values(array_diff($expectedTables, $actualTables));
    if ($missing) {
        throw new RuntimeException('Не найдены таблицы: ' . implode(', ', $missing));
    }

    $mutex = (int) $pdo->query('SELECT COUNT(*) FROM app_mutex WHERE id = 1')->fetchColumn();
    if ($mutex !== 1) {
        throw new RuntimeException('В таблице app_mutex отсутствует служебная строка.');
    }

    echo "OK: подключение к MySQL работает.\n";
    echo "База: {$database}\n";
    echo 'Таблицы: ' . count($actualTables) . " из " . count($expectedTables) . "\n";
    echo 'Пароли: ' . (defined('PASSWORD_ARGON2ID') ? 'Argon2id' : 'bcrypt') . "\n";
} catch (PDOException $error) {
    $number = is_array($error->errorInfo ?? null) ? ($error->errorInfo[1] ?? null) : null;
    $suffix = is_int($number) ? " (код MySQL {$number})" : '';
    fwrite(STDERR, "ОШИБКА: подключение к MySQL не удалось{$suffix}. Проверьте DB_DSN, DB_USER и DB_PASSWORD.\n");
    exit(1);
} catch (Throwable $error) {
    fwrite(STDERR, 'ОШИБКА: ' . $error->getMessage() . "\n");
    exit(1);
}
