<?php
// Temporary connectivity check. No credentials and no database mutations.
ini_set('display_errors', '0');
header('Content-Type: text/plain; charset=utf-8');
header('Cache-Control: no-store');
header('X-Robots-Tag: noindex, nofollow');
echo "ESCAPE — проверка хостинга\n\n";
echo 'PHP: ' . PHP_VERSION . "\n";
echo 'cURL: ' . (extension_loaded('curl') ? 'OK' : 'НЕТ') . "\n";
echo 'Сессии: ' . (extension_loaded('session') ? 'модуль доступен' : 'НЕТ') . "\n";
foreach (['post_max_size', 'upload_max_filesize', 'max_execution_time', 'memory_limit'] as $key) {
    echo $key . ': ' . ini_get($key) . "\n";
}
if (!extension_loaded('curl')) {
    exit("\nДля подключения к Google требуется cURL.\n");
}
$url = getenv('GOOGLE_API_URL') ?: '';
if ($url === '') {
    exit("\nGOOGLE_API_URL не задан.\n");
}
$curl = curl_init($url);
curl_setopt_array($curl, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_FOLLOWLOCATION => true,
    CURLOPT_MAXREDIRS => 5,
    CURLOPT_CONNECTTIMEOUT => 10,
    CURLOPT_TIMEOUT => 25,
    CURLOPT_PROTOCOLS => CURLPROTO_HTTPS,
    CURLOPT_REDIR_PROTOCOLS => CURLPROTO_HTTPS,
    CURLOPT_SSL_VERIFYPEER => true,
    CURLOPT_SSL_VERIFYHOST => 2,
]);
$body = curl_exec($curl);
$status = curl_getinfo($curl, CURLINFO_HTTP_CODE);
$error = curl_errno($curl);
curl_close($curl);
$data = is_string($body) ? json_decode($body, true) : null;
echo "\nGoogle HTTP: " . $status . "\n";
if ($error) {
    echo 'Ошибка соединения cURL: ' . $error . "\n";
} elseif ($status === 200 && ($data['success'] ?? false) === true && ($data['data']['service'] ?? '') === 'ESCAPE API') {
    echo "Соединение с ESCAPE API: OK\n";
} else {
    echo "Ожидаемый ответ ESCAPE API не получен.\n";
}
echo "\nЭто проверка GET-соединения, без входа и записи данных.\n";
echo "После проверки удалите этот файл с хостинга.\n";
