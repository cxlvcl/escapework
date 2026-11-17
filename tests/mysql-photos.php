<?php
// Included after the work-day suite; use a fresh fixture with the same real backend.
$db = new TestPDO();
$db->exec($schema);
foreach ($input['tables'] as $table => $rows) foreach ($rows as $i => $row) {
    if ($table === 'stations') $row['sort_order'] = $i;
    $columns = implode(',', array_map(fn($name) => '`'.$name.'`', array_keys($row)));
    $placeholders = implode(',', array_fill(0, count($row), '?'));
    $db->prepare("INSERT INTO $table ($columns) VALUES ($placeholders)")->execute(array_values($row));
}
$ref->getProperty('db')->setValue($backend, $db);
$scalar = fn(string $sql) => $db->query($sql)->fetchColumn();
$setTime('2026-09-06T15:00:00Z');
$call('shift', ['action'=>'open', 'stationId'=>$stationId], 'cook');
$call('assignAdditional', ['typeId'=>$input['tables']['additional_task_types'][0]['id'], 'userIds'=>[$input['tables']['users'][1]['id']]]);
$additionalId = $scalar('SELECT id FROM additional_tasks');
$body = ['category'=>'station', 'id'=>$input['tables']['station_tasks'][0]['id'], 'mimeType'=>'image/webp'];
$photos = $input['photosBase64'];
$originalFiles = glob($input['photoDir'].'/*.webp');
foreach ([[], [...$photos, $photos[0]], 'invalid', null, [$photos[0], 7], [$photos[0], 'invalid webp']] as $images) {
    rejected(fn() => $call('complete', $body+['photosBase64'=>$images], 'cook'), 400);
    check(glob($input['photoDir'].'/*.webp') === $originalFiles, 'Invalid photo set saved files');
}
rejected(fn() => $call('complete', $body, 'cook'), 400);
rejected(fn() => $call('complete', $body+['photosBase64'=>$photos,'photoBase64'=>$photos[0]], 'cook'), 400);
// A failure after file saves must roll back both the completion and all four files.
$db->exec("CREATE TRIGGER reject_photo_operation BEFORE INSERT ON operations BEGIN SELECT RAISE(ABORT,'photo rollback'); END");
try { $call('complete', $body+['photosBase64'=>$photos], 'cook'); throw new RuntimeException('Expected photo rollback'); } catch (PDOException) {}
check(glob($input['photoDir'].'/*.webp') === $originalFiles, 'Rollback left orphan photos');
check((int)$scalar('SELECT COUNT(*) FROM station_task_completions') === 0, 'Failed upload left a completion');
$db->exec('DROP TRIGGER reject_photo_operation');
foreach ([
    ['station', $input['tables']['station_tasks'][0]['id'], 'station_task_completions'],
    ['refrigerator', $input['tables']['refrigerator_tasks'][0]['id'], 'refrigerator_task_completions'],
    ['additional', $additionalId, 'additional_tasks'],
] as [$category, $id, $table]) {
    $data = ['category'=>$category, 'id'=>$id, 'mimeType'=>'image/webp', 'photosBase64'=>$photos];
    $requestId = uuid();
    $backend->execute('complete', $data, 'cook', $requestId);
    $backend->execute('complete', $data, 'cook', $requestId);
    check((int)$scalar("SELECT COUNT(*) FROM $table") === 1, 'Photo array or retry created duplicate completion');
    $row = $db->query("SELECT * FROM $table")->fetch();
    $paths = json_decode($row['photo_path'], true, 512, JSON_THROW_ON_ERROR);
    check(count($paths) === 4 && strlen($row['photo_path']) <= 255, 'References do not fit existing production column');
    foreach ($photos as $index => $bytes) {
        $query = ['category'=>$category, 'id'=>$row['id'], 'index'=>$index];
        check($call('getPhoto', $query, 'cook')['base64'] === $bytes, 'Cook photo order or content changed');
        check($call('getPhoto', $query)['base64'] === $bytes, 'Manager cannot read photo');
        check((fileperms($input['photoDir'].'/'.substr($paths[$index],6)) & 0777) === 0600, 'Photo is not private');
    }
    foreach ([-1, 4, '1', 0.5] as $index) rejected(fn() => $call('getPhoto', ['category'=>$category,'id'=>$row['id'],'index'=>$index], 'cook'), 404);
    check($call('getPhoto', ['category'=>$category,'id'=>$row['id']], 'cook')['base64'] === $photos[0], 'Old first-photo URL broke');
    rejected(fn() => $backend->execute('complete', array_replace($data,['photosBase64'=>array_reverse($photos)]), 'cook', $requestId), 409);
    if ($category !== 'additional') {
        $call('shift', ['action'=>'close'], 'cook');
        rejected(fn() => $call('getPhoto', ['category'=>$category,'id'=>$row['id'],'index'=>3], 'cook'), 403);
        $call('shift', ['action'=>'open','stationId'=>$stationId], 'cook');
    } else {
        $db->exec('DELETE FROM additional_task_assignees');
        rejected(fn() => $call('getPhoto', ['category'=>$category,'id'=>$row['id'],'index'=>3], 'cook'), 403);
        $db->prepare('INSERT INTO additional_task_assignees VALUES (?,?)')->execute([$id,$input['tables']['users'][1]['id']]);
    }
}
$kitchen = $call('getKitchen', [], 'cook');
$additional = $call('getAdditional', [], 'cook');
foreach ([$kitchen['tasks'][0],$kitchen['fridges'][0],$additional['tasks'][0]] as $task) {
    check($task['photoCount'] === 4 && !array_key_exists('photo_path',$task), 'Task count missing or private path exposed');
}
check($call('getStatistics', ['period'=>'today'])['summary']['completed'] === 3, 'Photo count inflated task statistics');
check(count(glob($input['photoDir'].'/*.webp')) === count($originalFiles)+12, 'Incorrect saved photo count');
// Old clients and existing rows still use a single reference and unindexed URL.
$legacyTask = $input['tables']['station_tasks'][1]['id'];
$call('complete', array_replace($body,['id'=>$legacyTask,'photoBase64'=>$photos[0]]), 'cook');
$legacy = $db->query("SELECT * FROM station_task_completions WHERE task_id='$legacyTask'")->fetch();
check(str_starts_with($legacy['photo_path'],'local:'), 'Single-photo storage changed');
check($call('getPhoto',['category'=>'station','id'=>$legacy['id']],'cook')['base64'] === $photos[0], 'Legacy single-photo read failed');
$setTime('2026-09-07T00:59:59Z');
check($call('getKitchen', [], 'cook')['tasks'][0]['photoCount'] === 4, 'Photos disappeared before 04:00');
$setTime('2026-09-07T01:00:00Z');
$call('snapshot');
check($call('getKitchen', [], 'cook')['tasks'][0]['photoCount'] === 0, 'Photo count did not reset at 04:00');
check($call('getStatistics', ['period'=>'yesterday'])['summary']['completed'] === 4, 'Snapshot counted photos instead of completions');
echo "PHP multiple photos: limits, all categories, ordering, permissions, legacy compatibility, atomic rollback, retries and 04:00 passed\n";
