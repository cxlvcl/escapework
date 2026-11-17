<?php
declare(strict_types=1);
ini_set('display_errors', '0');
header('Cache-Control: private, no-store');
header('X-Content-Type-Options: nosniff');
header('Content-Type: application/json; charset=utf-8');
require_once __DIR__.'/admin-security.php';
$securityKind='';$securityLogin='';
register_shutdown_function(static function()use(&$config,&$securityKind,&$securityLogin){if(isset($config)&&is_array($config))adminSecurityRecord($config,http_response_code()?:200,$securityKind,$securityLogin);});
final class ApiError extends RuntimeException {
    public function __construct(string $message, public int $status = 400, public string $kind = 'INVALID_INPUT') { parent::__construct($message); }
}
function fail(string $message, int $status = 400, string $kind = 'INVALID_INPUT'): never { throw new ApiError($message, $status, $kind); }
function result(mixed $data): never { echo json_encode(['success' => true, 'data' => $data, 'error' => null], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR); exit; }
function uuid(): string {
    $b = random_bytes(16); $b[6] = chr((ord($b[6]) & 15) | 64); $b[8] = chr((ord($b[8]) & 63) | 128);
    $h = bin2hex($b); return substr($h,0,8).'-'.substr($h,8,4).'-'.substr($h,12,4).'-'.substr($h,16,4).'-'.substr($h,20);
}
function cookieToken(): ?string {
    $token = $_COOKIE['escape_session'] ?? null;
    return is_string($token) && preg_match('/^[A-Za-z0-9_-]{43}$/D', $token) ? $token : null;
}
function setToken(string $token, int $expires): void {
    global $config;
    setcookie('escape_session', $token, ['expires' => $expires, 'path' => '/', 'secure' => str_starts_with($config['origin'], 'https://'), 'httponly' => true, 'samesite' => 'Lax']);
}
function google(string $action, array $data = [], ?string $token = null, ?string $requestId = null): mixed {
    global $config;
    $payload = json_encode(['action' => $action, 'data' => (object)$data, 'token' => $token, 'requestId' => $requestId ?? uuid(), 'timestamp' => (int)floor(microtime(true)*1000)], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
    $body = json_encode(['payload' => $payload, 'signature' => hash_hmac('sha256', $payload, $config['google_secret'])], JSON_THROW_ON_ERROR);
    $url = $config['google_url'];
    $deadline = microtime(true) + 55;
    for ($redirect = 0; $redirect < 6; $redirect++) {
        $parsed = parse_url($url);
        $test = PHP_SAPI === 'cli-server' && getenv('ESCAPE_PHP_TEST') === '1' && ($parsed['host'] ?? '') === '127.0.0.1';
        if (!$test && (($parsed['scheme'] ?? '') !== 'https' || !in_array($parsed['host'] ?? '', ['script.google.com', 'script.googleusercontent.com'], true) || isset($parsed['user']) || isset($parsed['port']))) fail('Некорректный адрес Google.', 503);
        $curl = curl_init($url); $response = '';
        curl_setopt_array($curl, [CURLOPT_FOLLOWLOCATION => false, CURLOPT_CONNECTTIMEOUT => 10,
            CURLOPT_TIMEOUT_MS => max(1, (int)(($deadline-microtime(true))*1000)),
            CURLOPT_SSL_VERIFYPEER => true, CURLOPT_SSL_VERIFYHOST => 2,
            CURLOPT_WRITEFUNCTION => static function($ch, string $chunk) use (&$response): int {
                if (strlen($response)+strlen($chunk) > 6*1024*1024) return 0;
                $response .= $chunk; return strlen($chunk);
            },
        ]);
        if ($body !== null) curl_setopt_array($curl, [CURLOPT_POST => true, CURLOPT_POSTFIELDS => $body, CURLOPT_HTTPHEADER => ['Content-Type: application/json']]);
        $ok = curl_exec($curl); $status = curl_getinfo($curl, CURLINFO_HTTP_CODE); $next = curl_getinfo($curl, CURLINFO_REDIRECT_URL); curl_close($curl);
        if ($ok === false) fail('Google недоступен или отвечает слишком долго. Повторите попытку.', 503, 'BACKEND_UNAVAILABLE');
        if (in_array($status, [301,302,303,307,308], true) && $next) { $url = $next; if (in_array($status,[301,302,303],true)) $body = null; continue; }
        if ($status !== 200) fail('Не удалось связаться с Google.', 503);
        $value = json_decode($response, true);
        if (!is_array($value) || !is_bool($value['success'] ?? null)) fail('Google вернул неверный ответ.', 503);
        if (!$value['success']) {
            $error = $value['error'] ?? []; $code = (int)($error['status'] ?? 503);
            fail($error['message'] ?? 'Ошибка Google.', $code >= 400 && $code <= 599 ? $code : 503, $error['code'] ?? 'BACKEND_ERROR');
        }
        return $value['data'] ?? null;
    }
    fail('Слишком много перенаправлений Google.', 503);
}
function backend(string $action, array $data = [], ?string $token = null, ?string $requestId = null): mixed {
    global $config;
    if (($config['backend'] ?? 'google') === 'google') return google($action, $data, $token, $requestId);
    if ($config['backend'] !== 'mysql') fail('Неизвестный backend.',503);
    require_once __DIR__.'/mysql.php';
    static $mysql;
    $mysql ??= new MysqlBackend($config);
    return $mysql->execute($action,$data,$token,$requestId);
}
function requireRole(?string $permission = null): array {
    $token = cookieToken(); if (!$token) fail('Войдите в систему.',401,'UNAUTHORIZED');
    $user = backend('getCurrentUser', [], $token);
    if (($permission === 'manage' && $user['role'] !== 'sous_chef') || ($permission === 'complete' && $user['role'] !== 'cook')) fail('Недостаточно прав.',403,'FORBIDDEN');
    return $user;
}
function pick(array $data, array $keys): array { return array_intersect_key($data, array_flip($keys)); }
function validPassword(mixed $password, int $min = 8): string {
    if (!is_string($password) || !preg_match('//u', $password)) fail('Некорректный пароль.');
    $length = preg_match_all('/./us', $password);
    if ($length < $min || $length > 128) fail('Пароль должен содержать от '.$min.' до 128 символов.');
    return $password;
}
function uploadedPhotos(): array {
    if (isset($_FILES['photos'], $_FILES['photo'])) fail('Передайте один список фотографий.');
    if (isset($_FILES['photos'])) {
        $upload = $_FILES['photos'];
        $errors = $upload['error'] ?? null;
        if (!is_array($errors) || !array_is_list($errors) || count($errors) < 1 || count($errors) > 4) fail('Прикрепите от 1 до 4 фотографий.');
        $files = [];
        foreach ($errors as $index => $error) {
            $files[] = ['error'=>$error, 'tmp_name'=>$upload['tmp_name'][$index] ?? null, 'size'=>$upload['size'][$index] ?? null];
        }
        return $files;
    }
    if (isset($_FILES['photo']) && !is_array($_FILES['photo']['error'] ?? null)) return [$_FILES['photo']];
    fail('Прикрепите от 1 до 4 фотографий.');
}
function photoBytes(array $file): string {
    if (in_array($file['error'] ?? -1, [UPLOAD_ERR_INI_SIZE, UPLOAD_ERR_FORM_SIZE], true)) fail('Фотография должна быть до 3 МБ.',413);
    if (($file['error'] ?? -1) !== UPLOAD_ERR_OK || !is_string($file['tmp_name'] ?? null) || !is_uploaded_file($file['tmp_name'])) fail('Не удалось загрузить фотографию. Выберите снимок повторно.');
    if (($file['size'] ?? 0) < 1 || $file['size'] > 3*1024*1024) fail('Фотография должна быть до 3 МБ.',413);
    $bytes = file_get_contents($file['tmp_name']);
    if ($bytes === false || strlen($bytes) !== $file['size']) fail('Не удалось прочитать фото.');
    $meta = @getimagesizefromstring($bytes);
    if (!$meta || !in_array($meta[2], [IMAGETYPE_WEBP, IMAGETYPE_JPEG], true) || $meta[0] < 1 || $meta[1] < 1 || $meta[0] > 1600 || $meta[1] > 1600) fail('Требуется сжатое фото WebP или JPEG до 1600 пикселей.');
    // Browser already resizes and strips metadata. GAS independently validates WebP.
    if ($meta[2] === IMAGETYPE_WEBP) return $bytes;
    if (!function_exists('imagecreatefromstring') || !function_exists('imagewebp')) fail('Для JPEG включите GD с WebP на хостинге.',503,'STORAGE_CONFIG');
    $image = @imagecreatefromstring($bytes); if (!$image) fail('Не удалось прочитать фото.');
    ob_start(); $ok = imagewebp($image, null, 70); $output = ob_get_clean(); imagedestroy($image);
    if (!$ok || !$output || strlen($output) > 3*1024*1024) fail('Не удалось обработать фото.');
    return $output;
}
try {
    $test = PHP_SAPI === 'cli-server' && getenv('ESCAPE_PHP_TEST') === '1';
    $config = require ($test ? getenv('ESCAPE_PHP_CONFIG') : __DIR__ . '/config.php');
    if (!is_array($config) || strlen($config['google_secret'] ?? '') < 32 || !filter_var($config['google_url'] ?? '', FILTER_VALIDATE_URL) || !preg_match('#^https://[a-z0-9.-]+$#D', $config['origin'] ?? '') && !$test) fail('Сервер ещё не настроен.',503);
    if (PHP_SAPI === 'cli' && defined('ESCAPE_SNAPSHOT_CLI')) result(backend('snapshot'));
    if (!$test && ($_SERVER['HTTPS'] ?? '') !== 'on') fail('Откройте сайт по HTTPS.', 403);
    $path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
    $method = $_SERVER['REQUEST_METHOD'];
    if ($path === '/api/cron' && $method === 'POST') {
        $secret = $config['cron_secret'] ?? '';
        if (strlen($secret)<32 || !hash_equals('Bearer '.$secret, $_SERVER['HTTP_AUTHORIZATION'] ?? '')) fail('Недостаточно прав.',403);
        result(backend('snapshot'));
    }
    if ($method === 'GET') {
        if (!cookieToken()) fail('Войдите в систему.',401,'UNAUTHORIZED');
        if ($path === '/api/admin') result(backend('adminRead',pick($_GET,['view','table','page','search','from','to','active','ip','kind']),cookieToken()));
        if ($path === '/api/read' || $path === '/api/activity' || $path === '/api/photos') {
            $views = ['user'=>'getCurrentUser','kitchen'=>'getKitchen','additional'=>'getAdditional','users'=>'getUsers','activity'=>'getActivity','statistics'=>'getStatistics','photos'=>'getPhotos'];
            $view = $path === '/api/activity' ? 'activity' : ($path === '/api/photos' ? 'photos' : ($_GET['view'] ?? ''));
            if (!is_string($view) || !isset($views[$view])) fail('Страница не найдена.',404);
            $query = match ($view) { 'statistics' => pick($_GET,['period','stationId']), 'photos' => pick($_GET,['date']), default => [] };
            result(backend($views[$view], $query, cookieToken()));
        }
        if (preg_match('#^/api/photos/(station|refrigerator|additional)/([a-f0-9-]{36})$#D', $path, $matches)) {
            $index = $_GET['index'] ?? '0';
            if (!is_string($index) || !preg_match('/^[0-3]$/D', $index)) fail('Фото не найдено.',404,'NOT_FOUND');
            $photo = backend('getPhoto',['category'=>$matches[1],'id'=>$matches[2],'index'=>(int)$index],cookieToken());
            header('Content-Type: image/webp'); echo base64_decode($photo['base64'],true); exit;
        }
        fail('Страница не найдена.',404);
    }
    if ($method !== 'POST') fail('Метод не разрешён.',405);
    if (($_SERVER['HTTP_ORIGIN'] ?? '') !== $config['origin']) fail('Недопустимый источник запроса.',403,'FORBIDDEN');
    if ((int)($_SERVER['CONTENT_LENGTH'] ?? 0) > (in_array($path,['/api/complete','/api/admin/photos'],true) ? 13 : 5)*1024*1024) fail('Запрос слишком большой.',413);
    if (in_array($path,['/api/complete','/api/admin/photos'],true)) $data = $_POST;
    else {
        $raw = file_get_contents('php://input', false, null, 0, 5*1024*1024+1);
        if (strlen($raw)>5*1024*1024) fail('Запрос слишком большой.',413);
        $data = json_decode($raw,true);
        if (!is_array($data)) fail('Неверный формат запроса.');
    }
    if ($path === '/api/login') {
        $securityLogin=is_string($data['login']??null)?$data['login']:'';
        $password = validPassword($data['password'] ?? null,1);
        $token = rtrim(strtr(base64_encode(random_bytes(32)),'+/','-_'),'=');
        $answer = backend('login',['login'=>$data['login'] ?? '', 'password'=>$password, 'sessionToken'=>$token]);
        setToken($token,strtotime($answer['expiresAt'])); result(['ok'=>true]);
    }
    if ($path === '/api/logout') {
        if (cookieToken()) backend('logout',[],cookieToken());
        setToken('',time()-3600); result(['ok'=>true]);
    }
    $requestId = $_SERVER['HTTP_IDEMPOTENCY_KEY'] ?? uuid();
    if (!preg_match('/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iD',$requestId)) fail('Некорректный ключ запроса.');
    switch ($path) {
        case '/api/admin': $action='adminWrite';$data=pick($data,['operation','table','id','revision','record']);break;
        case '/api/admin/photos':
            backend('adminRead',[],cookieToken());
            $action='adminWrite';$record=json_decode($data['record']??'{}',true);
            $data=pick($data,['table','id','revision']);$data['operation']='save';$data['record']=$record;
            $data['photosBase64']=array_map(static fn(array $file): string => base64_encode(photoBytes($file)),uploadedPhotos());break;
        case '/api/users':
            requireRole('manage');
            if (($data['action'] ?? '') === 'delete') { $action = 'deleteUser'; $data = pick($data,['id']); break; }
            $action = empty($data['id']) ? 'createUser' : 'updateUser';
            $data = pick($data,['id','name','login','role','password']);
            if ($action === 'createUser' || ($data['password'] ?? '') !== '') {
                $data['password'] = validPassword($data['password'] ?? null);
                $data['credentialFingerprint'] = hash_hmac('sha256',$data['password'],$config['google_secret']);
            } else unset($data['password']);
            break;
        case '/api/shift': $action='shift'; $data=pick($data,['action','stationId']); break;
        case '/api/tasks': $action='task'; $data=pick($data,['action','id','stationId','title','taskType','direction','category','refrigeratorId']); break;
        case '/api/additional': $action='assignAdditional'; $data=pick($data,['typeId','userIds']); break;
        case '/api/additional-types': $action='additionalType'; $data=pick($data,['id','title','isActive']); break;
        case '/api/complete':
            requireRole('complete'); $action='complete'; $data=pick($data,['id','category']);
            $data['photosBase64']=array_map(static fn(array $file): string => base64_encode(photoBytes($file)), uploadedPhotos()); $data['mimeType']='image/webp'; break;
        default: fail('Страница не найдена.',404);
    }
    result(backend($action,$data,cookieToken(),$requestId));
} catch (Throwable $error) {
    $securityKind=$error instanceof ApiError?$error->kind:'SERVER_ERROR';
    $status = $error instanceof ApiError ? $error->status : 503;
    http_response_code($status);
    echo json_encode(['success'=>false,'data'=>null,'error'=>['code'=>$error instanceof ApiError ? $error->kind : 'SERVER_ERROR','message'=>$error instanceof ApiError ? $error->getMessage() : 'Не удалось выполнить запрос. Проверьте настройки сервера.']],JSON_UNESCAPED_UNICODE);
}
