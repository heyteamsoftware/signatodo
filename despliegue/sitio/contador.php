<?php
// Contador anónimo de visitas y descargas de la página de Signatodo.
// Solo guarda totales (y totales por día). Sin cookies, sin IP y sin ningún identificador de la persona.
// Para no contar dos veces lo mismo en poco tiempo usa, durante 30 minutos, una huella cifrada e irreversible de la
// conexión (con una sal aleatoria que cambia cada día) y después la descarta.
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

$dir = __DIR__ . '/data';
if (!is_dir($dir)) { @mkdir($dir, 0775, true); }
if (!is_file($dir . '/.htaccess')) { @file_put_contents($dir . '/.htaccess', "Require all denied\n"); }

$eventos = ['visita', 'descarga'];
$evento = '';
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST') {
  $evento = is_string($_POST['evento'] ?? null) ? $_POST['evento'] : '';
  if (!in_array($evento, $eventos, true)) { $evento = ''; }
  // Solo cuentan los avisos que salen de esta misma web.
  $origen = $_SERVER['HTTP_ORIGIN'] ?? ($_SERVER['HTTP_REFERER'] ?? '');
  $anfitrion = $_SERVER['HTTP_HOST'] ?? '';
  if ($origen === '' || parse_url($origen, PHP_URL_HOST) !== $anfitrion) { $evento = ''; }
  // «No rastrear» y «Global Privacy Control»: no se cuenta nada.
  if (($_SERVER['HTTP_DNT'] ?? '') === '1' || ($_SERVER['HTTP_SEC_GPC'] ?? '') === '1') { $evento = ''; }
}

$fp = @fopen($dir . '/contador.json', 'c+');
if (!$fp) { http_response_code(500); echo json_encode(['error' => 'sin acceso a datos']); exit; }
flock($fp, LOCK_EX);
$d = json_decode(stream_get_contents($fp), true);
if (!is_array($d)) { $d = []; }
$d += ['total' => [], 'dias' => [], 'recientes' => [], 'sal' => '', 'salDia' => ''];
foreach ($eventos as $e) { $d['total'][$e] = (int)($d['total'][$e] ?? 0); }

if ($evento !== '') {
  $ahora = time();
  $hoy = date('Y-m-d');
  if ($d['salDia'] !== $hoy) { $d['sal'] = bin2hex(random_bytes(16)); $d['salDia'] = $hoy; $d['recientes'] = []; }
  foreach ($d['recientes'] as $h => $t) { if ($ahora - $t > 1800) { unset($d['recientes'][$h]); } }
  $huella = hash('sha256', $d['sal'] . '|' . ($_SERVER['REMOTE_ADDR'] ?? '') . '|' . $evento);
  if (!isset($d['recientes'][$huella]) && count($d['recientes']) < 5000) {
    $d['recientes'][$huella] = $ahora;
    $d['total'][$evento]++;
    $d['dias'][$hoy][$evento] = (int)($d['dias'][$hoy][$evento] ?? 0) + 1;
    if (count($d['dias']) > 400) { $d['dias'] = array_slice($d['dias'], -400, null, true); }
    ftruncate($fp, 0); rewind($fp);
    fwrite($fp, json_encode($d));
  }
}
flock($fp, LOCK_UN);
fclose($fp);

echo json_encode(['visitas' => $d['total']['visita'], 'descargas' => $d['total']['descarga']]);
