import { cp, mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const root = process.cwd();
const temp = await mkdtemp(path.join(tmpdir(), 'escape-admin-package-'));
const output = path.join(root, 'hosting/admin-update.zip');
try {
  await mkdir(path.join(temp, 'escape-private'));
  for (const name of ['mysql.php', 'gateway.php', 'mysql-admin.php', 'admin-security.php', 'admin-install.php', 'admin-schema.sql']) {
    await cp(path.join(root, 'hosting/dist/escape-private', name), path.join(temp, 'escape-private', name));
  }
  await mkdir(path.join(temp, 'www'));
  for (const name of ['assets', 'icons', 'admin', 'index.html', 'manifest.json', 'apple-touch-icon.png', 'favicon-32.png']) {
    await cp(path.join(root, 'hosting/dist/www', name), path.join(temp, 'www', name), { recursive: true });
  }
  for (const name of ['install-admin.sh', 'rollback-admin.sh', 'ADMIN_UPDATE.md']) {
    await cp(path.join(root, 'hosting', name), path.join(temp, name));
  }
  await rm(output, { force: true });
  const result = spawnSync('zip', ['-qr', output, '.'], { cwd: temp, stdio: 'inherit' });
  if (result.status !== 0) throw new Error('ZIP creation failed');
  const sha = createHash('sha256').update(await readFile(output)).digest('hex');
  await writeFile(path.join(root, 'hosting/admin-update.sha256'), `${sha}  admin-update.zip\n`);
  console.log(`Admin server package: ${output}\nSHA-256: ${sha}`);
} finally {
  await rm(temp, { recursive: true, force: true });
}
