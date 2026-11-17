<?php
require __DIR__.'/admin-pdo.php';
$db=new AdminTestPDO($argv[1]);$db->exec(adminTestSchema(file_get_contents(__DIR__.'/../hosting/server/mysql-schema.sql')));$db->exec(adminTestSchema(file_get_contents(__DIR__.'/../hosting/server/admin-schema.sql')));
$hash=password_hash('test-password-123',PASSWORD_BCRYPT);
foreach(['admin'=>'sous_chef','manager'=>'sous_chef','cook'=>'cook'] as $login=>$role){$id=match($login){'admin'=>'a0000000-0000-4000-8000-000000000001','manager'=>'a0000000-0000-4000-8000-000000000002',default=>'a0000000-0000-4000-8000-000000000003'};$db->prepare('INSERT INTO users (id,name,login,password_hash,role) VALUES (?,?,?,?,?)')->execute([$id,$login,$login,$hash,$role]);if($login==='admin')$db->prepare('INSERT INTO admin_members (user_id,granted_at) VALUES (?,?)')->execute([$id,gmdate('Y-m-d\TH:i:s').'.000Z']);}
