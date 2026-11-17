<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
try {
    $config = require __DIR__.'/config.php';
    if (($config['backend']??'') !== 'mysql') throw new RuntimeException('Для админ-панели требуется MySQL.');
    $login = trim($argv[1]??'');
    if ($login === '') { fwrite(STDOUT,"Логин существующего администратора: "); $login=trim(fgets(STDIN)?:''); }
    if ($login === '' || strlen($login)>320) throw new RuntimeException('Укажите существующий логин.');
    $db = new PDO($config['db_dsn'],$config['db_user'],$config['db_password'],[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION,PDO::ATTR_EMULATE_PREPARES=>false,PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC]);
    $q=$db->prepare("SELECT id,name,role FROM users WHERE login=? AND deleted_at IS NULL");$q->execute([$login]);$user=$q->fetch();
    if (!$user || $user['role']==='cook') throw new RuntimeException('Нужен существующий аккаунт су-шефа, шефа или аудита.');
    if(($argv[2]??'')==='--revoke'){
        $db->beginTransaction();$db->query('SELECT id FROM app_mutex WHERE id=1 FOR UPDATE')->fetch();
        $q=$db->prepare("SELECT a.user_id FROM admin_members a JOIN users u ON u.id=a.user_id WHERE a.user_id<>? AND u.deleted_at IS NULL AND u.role<>'cook'");$q->execute([$user['id']]);if(!$q->fetch())throw new RuntimeException('Нельзя отозвать доступ последнего администратора.');
        $db->prepare('DELETE FROM admin_members WHERE user_id=?')->execute([$user['id']]);$db->prepare('DELETE FROM sessions WHERE user_id=?')->execute([$user['id']]);$db->commit();echo "Доступ администратора отозван.\n";exit;
    }
    // Additive, repeatable migration. Enable the feature only after all tables and seed rows exist.
    foreach(explode(';',file_get_contents(__DIR__.'/admin-schema.sql')) as $sql){
        if(trim($sql)==='')continue;
        if(!preg_match('/CREATE TABLE IF NOT EXISTS (admin_[a-z_]+)/',$sql,$match))throw new RuntimeException('Неизвестная команда миграции.');
        // A runtime user may have only DML privileges after an operator imported the schema.
        try{$db->query('SELECT 1 FROM '.$match[1].' LIMIT 0');continue;}
        catch(PDOException $e){if($e->getCode()!=='42S02')throw $e;}
        $db->exec($sql);
    }
    $db->beginTransaction();
    $db->query('SELECT id FROM app_mutex WHERE id=1 FOR UPDATE')->fetch();
    $now=gmdate('Y-m-d\TH:i:s').'.000Z';
    $q=$db->prepare('INSERT INTO admin_members (user_id,granted_at) VALUES (?,?) ON DUPLICATE KEY UPDATE granted_at=granted_at');$q->execute([$user['id'],$now]);
    $rows=$db->query('SELECT u.id,u.name,u.active_station_id,s.name station_name FROM users u JOIN stations s ON s.id=u.active_station_id WHERE u.deleted_at IS NULL')->fetchAll();
    foreach($rows as $r){
        $q=$db->prepare('SELECT id FROM admin_shifts WHERE user_id=? AND closed_at IS NULL');$q->execute([$r['id']]);if($q->fetch())continue;
        $h=bin2hex(random_bytes(16));$id=substr($h,0,8).'-'.substr($h,8,4).'-4'.substr($h,13,3).'-8'.substr($h,17,3).'-'.substr($h,20);
        $db->prepare('INSERT INTO admin_shifts (id,user_id,station_id,user_name,station_name,opened_at,observed_at) VALUES (?,?,?,?,?,NULL,?)')->execute([$id,$r['id'],$r['active_station_id'],$r['name'],$r['station_name'],$now]);
    }
    $db->commit();
    $tmp=__DIR__.'/admin.ready.tmp';if(file_put_contents($tmp,'1')===false||!chmod($tmp,0600)||!rename($tmp,__DIR__.'/admin.ready'))throw new RuntimeException('Не удалось включить панель. Повторите установку.');
    echo "Админ-панель включена. Полный доступ: ".$user['name']." (".$login.").\n";
    echo "Открытые ранее смены отмечены без выдуманного времени открытия.\n";
} catch(Throwable $e) { if(isset($db)&&$db->inTransaction())$db->rollBack();fwrite(STDERR,"Установка не завершена: ".$e->getMessage()."\n");exit(1); }
