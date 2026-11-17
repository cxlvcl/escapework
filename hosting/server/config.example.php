<?php
// Store config.php and .env in escape-private, OUTSIDE the public www directory.
$values = [];
$envFile = __DIR__ . '/.env';
if (is_file($envFile)) {
    foreach (file($envFile, FILE_IGNORE_NEW_LINES) as $line) {
        if (!preg_match('/^([A-Z_]+)=(.*)$/D', trim($line), $match)) continue;
        $value = trim($match[2]);
        if (str_starts_with($value, '"')) $value = json_decode($value, true, 512, JSON_THROW_ON_ERROR);
        elseif (str_starts_with($value, "'")) $value = substr($value, 1, -1);
        if (is_string($value)) $values[$match[1]] = $value;
    }
}
return [
    'backend' => getenv('DB_BACKEND') ?: ($values['DB_BACKEND'] ?? 'google'),
    'db_dsn' => getenv('DB_DSN') ?: ($values['DB_DSN'] ?? ''),
    'db_user' => getenv('DB_USER') ?: ($values['DB_USER'] ?? ''),
    'db_password' => getenv('DB_PASSWORD') ?: ($values['DB_PASSWORD'] ?? ''),
    'photo_dir' => __DIR__ . '/photos',
    'origin' => getenv('APP_ORIGIN') ?: ($values['APP_ORIGIN'] ?? 'https://escapeworkspaceru.ru'),
    'google_url' => getenv('GOOGLE_API_URL') ?: ($values['GOOGLE_API_URL'] ?? ''),
    'google_secret' => getenv('GOOGLE_API_SECRET') ?: ($values['GOOGLE_API_SECRET'] ?? ''),
    'cron_secret' => getenv('CRON_SECRET') ?: ($values['CRON_SECRET'] ?? ''),
];
