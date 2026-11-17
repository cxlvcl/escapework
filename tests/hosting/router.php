<?php
$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
if (str_starts_with($path, '/api/')) {
    require __DIR__ . '/../../hosting/server/gateway.php';
    return;
}
$file = realpath(__DIR__ . '/../../hosting/dist/www' . $path);
$root = realpath(__DIR__ . '/../../hosting/dist/www');
if ($path !== '/' && $file && str_starts_with($file, $root.'/') && is_file($file)) return false;
header('Content-Type: text/html; charset=utf-8');
readfile($root . '/index.html');
