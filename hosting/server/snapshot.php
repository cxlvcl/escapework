<?php
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
define('ESCAPE_SNAPSHOT_CLI', true);
require __DIR__ . '/gateway.php';
