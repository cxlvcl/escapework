<?php
// Continue with the real four-photo/legacy fixture created by mysql-photos.php.
$setTime('2026-09-07T01:00:00Z');
check($call('getPhotos')['date'] === '2026-09-07', 'Gallery does not use current work date');
check(count($call('getPhotos')['tasks']) === 0, 'Yesterday photos leaked into today');
$db->prepare('UPDATE station_tasks SET is_active=0,inactive_work_date=? WHERE id=?')->execute(['2026-09-07',$body['id']]);
foreach (['sous_chef','chef','audit'] as $role) {
    $db->prepare('UPDATE users SET role=? WHERE id=?')->execute([$role,$input['tables']['users'][0]['id']]);
    $gallery = $call('getPhotos',['date'=>'2026-09-06']);
    check(count($gallery['tasks']) === 4, 'Archive omitted a category, legacy completion or disabled task');
    foreach ($gallery['tasks'] as $task) {
        check(!array_key_exists('photo_path',$task), 'Archive exposed private photo paths');
        $expected = $task['id'] === $legacyTask ? 1 : 4;
        check($task['photoCount'] === $expected, 'Archive photo count incorrect');
        for ($index=0; $index<$expected; $index++)
            check($call('getPhoto',['id'=>$task['photoId'],'category'=>$task['category'],'index'=>$index])['base64'] === $photos[$index], 'Historical image missing or reordered');
    }
}
$db->prepare('UPDATE users SET role=? WHERE id=?')->execute(['sous_chef',$input['tables']['users'][0]['id']]);
rejected(fn()=>$backend->execute('getPhotos'),401);
rejected(fn()=>$call('getPhotos',[],'cook'),403);
foreach ([null, [], 20260906, '', '2026-08-32', '2026-9-06', '2026-08-05', '2026-09-08', '2026-09-06T00:00:00Z'] as $date)
    rejected(fn()=>$call('getPhotos',['date'=>$date]),400);
foreach (['2026-08-06','2026-08-05'] as $day)
    $db->prepare('INSERT INTO station_task_completions (id,task_id,work_date,photo_path,completed_at) VALUES (?,?,?,?,?)')->execute([uuid(),$legacyTask,$day,$legacy['photo_path'],$day.'T12:00:00.000Z']);
$oldest = $call('getPhotos',['date'=>'2026-08-06']);
check($oldest['oldestDate'] === '2026-08-06' && count($oldest['tasks']) === 1, '32nd closed work day unavailable');
check(count($call('getPhotos',['date'=>'2026-08-07'])['tasks']) === 0, 'Empty date contains another day');
$setTime('2026-09-07T00:59:59.999Z');
check($call('getPhotos')['date'] === '2026-09-06' && count($call('getPhotos')['tasks']) === 4, 'Gallery reset before 04:00');
check(count($call('getPhotos',['date'=>'2026-08-05'])['tasks']) === 1, 'Oldest day shifted before 04:00');
$setTime('2026-09-07T01:00:00Z');
check($call('getPhotos')['date'] === '2026-09-07' && count($call('getPhotos')['tasks']) === 0, 'Gallery did not reset at 04:00');
rejected(fn()=>$call('getPhotos',['date'=>'2026-08-05']),400);
check((int)$scalar('SELECT COUNT(*) FROM station_task_completions') === 4, 'Archive read changed completions');
echo "PHP photo archive: monitoring roles, 32-day range, disabled tasks, all images and 04:00 boundaries passed\n";
