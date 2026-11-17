<?php
declare(strict_types=1);
function adminSecurityRecord(array $config,int $status,string $kind,string $login=''): void {
    if(($config['backend']??'')!=='mysql'||!is_file(__DIR__.'/admin.ready'))return;
    try {
        $db=new PDO($config['db_dsn'],$config['db_user'],$config['db_password'],[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION,PDO::ATTR_EMULATE_PREPARES=>false]);
        $ip=$_SERVER['REMOTE_ADDR']??'';if(!filter_var($ip,FILTER_VALIDATE_IP))$ip='unknown';
        // Do not trust client-supplied forwarding headers. Do not log query strings, bodies or cookies.
        $path=parse_url($_SERVER['REQUEST_URI']??'',PHP_URL_PATH)?:'/';
        $path=preg_replace('#/[a-f0-9-]{36}(?=/|$)#i','/:id',$path);
        if(!preg_match('#^/api/[a-zA-Z0-9/_:-]{0,90}$#D',$path))$path='/api/other';
        $minute=gmdate('Y-m-d\TH:i').':00.000Z';$now=gmdate('Y-m-d\TH:i:s').'.000Z';
        $id=hash('sha256',$minute.'|'.$ip);
        $db->prepare('INSERT INTO admin_traffic (id,minute_at,ip,request_count,error_count) VALUES (?,?,?,1,?) ON DUPLICATE KEY UPDATE request_count=request_count+1,error_count=error_count+VALUES(error_count)')->execute([$id,$minute,$ip,$status>=400?1:0]);
        if($status<400)return;
        $kind=match($kind){'BAD_LOGIN'=>'bad_login','RATE_LIMIT'=>'login_limit','FORBIDDEN'=>'forbidden','UNAUTHORIZED'=>'unauthorized',default=>$status>=500?'server_error':'rejected'};
        $login=mb_substr(preg_replace('/[\x00-\x1f\x7f]/u','',$login)??'',0,80);
        $agent=mb_substr(preg_replace('/[\x00-\x1f\x7f]/u','',$_SERVER['HTTP_USER_AGENT']??'')??'',0,250);
        // Aggregate errors per source, minute and category to bound log growth for repeated requests.
        $id=hash('sha256',$minute.'|'.$ip.'|'.$kind.'|'.$path);
        $db->prepare('INSERT INTO admin_security_events (id,occurred_at,ip,kind,status,login,path,user_agent,event_count) VALUES (?,?,?,?,?,?,?,?,1) ON DUPLICATE KEY UPDATE event_count=event_count+1,occurred_at=VALUES(occurred_at)')->execute([$id,$now,$ip,$kind,$status,$login,$path,$agent]);
    } catch(Throwable $e) { error_log('ESCAPE security log unavailable'); }
}
