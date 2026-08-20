<?php
/**
 * scripts/run_probe-realtime.php
 *
 * Script chay tu dong toan bo cac file audio mau trong thu muc samples
 * qua probe-realtime.mjs de test OpenAI Realtime API.
 *
 * Cach chay:
 *   php scripts/run_probe-realtime.php
 * Hoac truyen thu muc khac:
 *   php scripts/run_probe-realtime.php /path/to/samples
 */

// Thu muc goc cua du an (voice_bot_code_controlled)
$projectRoot = dirname(__DIR__);

// Duong dan file script mjs
$probeScript = $projectRoot . '/scripts/probe-realtime.mjs';

// Duong dan thu muc samples mac dinh
$defaultSamplesDir = realpath($projectRoot . '/../audio_test/samples')
    ?: '/Users/vovinhloc/myworking/customer/cnta/voice_bot/audio_test/samples';

// Cho phep truyen thu muc samples qua tham so CLI (neu co)
$samplesDir = isset($argv[1]) && is_dir($argv[1]) ? realpath($argv[1]) : $defaultSamplesDir;

// Kiem tra ton tai cua file script probe-realtime.mjs
if (!file_exists($probeScript)) {
    fwrite(STDERR, "[Loi] Khong tim thay script: {$probeScript}\n");
    exit(1);
}

// Kiem tra ton tai cua thu muc samples
if (!is_dir($samplesDir)) {
    fwrite(STDERR, "[Loi] Thu muc samples khong ton tai: {$samplesDir}\n");
    exit(1);
}

// Chuyen working directory ve goc du an de probe-realtime.mjs load dung .env va node_modules
chdir($projectRoot);

// Lay danh sach cac file trong thu muc
$allEntries = scandir($samplesDir);
$audioFiles = [];

foreach ($allEntries as $entry) {
    if ($entry === '.' || $entry === '..' || str_starts_with($entry, '.')) {
        continue;
    }
    $fullPath = $samplesDir . DIRECTORY_SEPARATOR . $entry;
    if (is_file($fullPath)) {
        $ext = strtolower(pathinfo($fullPath, PATHINFO_EXTENSION));
        // Uu tien cac file am thanh (.wav, .mp3, .m4a, ...)
        if (in_array($ext, ['wav', 'mp3', 'm4a', 'aac', 'ogg', 'flac'])) {
            $audioFiles[] = $fullPath;
        }
    }
}

// Sap xep danh sach file theo thu tu tu nhien (natural sort)
natsort($audioFiles);
$audioFiles = array_values($audioFiles);

$totalFiles = count($audioFiles);

echo "=================================================================\n";
echo "           RUN PROBE REALTIME AUDIO TEST BATCH                   \n";
echo "=================================================================\n";
echo "Thu muc samples : {$samplesDir}\n";
echo "Script probe    : {$probeScript}\n";
echo "Tong so file    : {$totalFiles}\n";
echo "=================================================================\n\n";

if ($totalFiles === 0) {
    echo "[Thong bao] Khong tim thay file audio nao trong thu muc: {$samplesDir}\n";
    exit(0);
}

$startTime = microtime(true);
$results = [];

foreach ($audioFiles as $index => $filePath) {
    $fileNum = $index + 1;
    $fileName = basename($filePath);
    $fileSizeKb = round(filesize($filePath) / 1024, 2);

    echo "-----------------------------------------------------------------\n";
    echo ">> [{$fileNum}/{$totalFiles}] Dang xu ly file: {$fileName} ({$fileSizeKb} KB)\n";
    echo ">> Duong dan: {$filePath}\n";
    echo "-----------------------------------------------------------------\n";

    // Lenh chay node probe-realtime.mjs <file_path>
    $command = sprintf(
        'node %s %s',
        escapeshellarg($probeScript),
        escapeshellarg($filePath)
    );

    $stepStart = microtime(true);
    $exitCode = 0;

    // Chay lenh va xuat truc tiep output ra console theo thoi gian thuc
    passthru($command, $exitCode);

    $duration = round(microtime(true) - $stepStart, 2);

    $status = ($exitCode === 0) ? 'THANH CONG' : 'THAT BAI (Exit code: ' . $exitCode . ')';
    $results[] = [
        'file' => $fileName,
        'status' => $status,
        'code' => $exitCode,
        'duration' => $duration,
    ];

    echo "\n>> Ket thuc file [{$fileNum}/{$totalFiles}] {$fileName} - {$status} ({$duration}s)\n\n";

    // Nghi 1 giay giua cac file de dong ket noi sach se
    if ($fileNum < $totalFiles) {
        sleep(1);
    }
    sleep(1);
}

$totalDuration = round(microtime(true) - $startTime, 2);

// In bang tong ket
echo "=================================================================\n";
echo "                       TONG KET TEST BATCH                       \n";
echo "=================================================================\n";
printf("%-4s | %-38s | %-12s | %-10s\n", "STT", "File", "Trang thai", "Thoi gian");
echo str_repeat("-", 70) . "\n";

$successCount = 0;
foreach ($results as $i => $res) {
    if ($res['code'] === 0) {
        $successCount++;
    }
    printf(
        "%-4d | %-38s | %-12s | %-10s\n",
        $i + 1,
        mb_strimwidth($res['file'], 0, 38, '...'),
        ($res['code'] === 0 ? "OK" : "ERR ({$res['code']})"),
        "{$res['duration']}s"
    );
}

echo str_repeat("=", 70) . "\n";
echo "Tong ket: {$successCount}/{$totalFiles} file thanh cong | Tong thoi gian: {$totalDuration}s\n";
echo "=================================================================\n";
