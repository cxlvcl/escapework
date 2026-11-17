<?php
// SQL dialect adapter for isolated browser tests. Never shipped to the server.
class AdminTestPDO extends PDO {
    public function __construct(string $file){parent::__construct('sqlite:'.$file,null,null,[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION,PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC]);$this->exec('PRAGMA foreign_keys=ON');}
    public function prepare(string $query,array $options=[]): PDOStatement|false {
        $query=str_replace(' FOR UPDATE','',$query);
        $key=str_contains($query,'INSERT INTO admin_objects')?'table_name,record_id':(str_contains($query,'INSERT INTO admin_members')?'user_id':(str_contains($query,'INSERT INTO login_attempts')?'key':'id'));
        $query=str_replace('ON DUPLICATE KEY UPDATE',"ON CONFLICT($key) DO UPDATE SET",$query);
        $query=preg_replace('/VALUES\((\w+)\)/','excluded.$1',$query);
        return parent::prepare($query,$options);
    }
}
function adminTestSchema(string $sql): string {
    $sql=preg_replace('/--[^\n]*/','',$sql);$sql=preg_replace('/SET NAMES[^;]+;/','',$sql);$sql=preg_replace('/\) ENGINE=[^;]+;/',');',$sql);
    $sql=str_replace([' CHARACTER SET ascii COLLATE ascii_bin',' CHARACTER SET ascii',' UNSIGNED'],'',$sql);$sql=preg_replace('/ENUM\([^)]+\)/','TEXT',$sql);$sql=preg_replace('/UNIQUE KEY \w+\(([^)]+)\)/','UNIQUE($1)',$sql);return preg_replace('/,\s*KEY \w+\([^)]+\)/','',$sql);
}
