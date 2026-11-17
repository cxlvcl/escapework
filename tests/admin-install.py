"""Exercise the shipped installer/rollback against an isolated hosting layout."""
import os
from pathlib import Path
import subprocess
import tempfile
import zipfile

root = Path(__file__).resolve().parents[1]
php = os.environ['ESCAPE_PHP_BIN']
with tempfile.TemporaryDirectory(prefix='escape-admin-install-test-') as temp:
    folder = Path(temp)
    bundle = folder / 'bundle'
    with zipfile.ZipFile(root / 'hosting/admin-update.zip') as archive:
        assert not any(Path(n).name in ('.env', 'config.php', 'admin.ready') for n in archive.namelist())
        archive.extractall(bundle)
    for enabled in (False, True):
        private = folder / ('private-' + str(enabled))
        public = folder / ('public-' + str(enabled))
        private.mkdir()
        public.mkdir()
        (private / 'photos').mkdir()
        (private / 'photos/retained.webp').write_bytes(b'photo-kept')
        for name in ('mysql.php', 'gateway.php', 'config.php', '.env'):
            (private / name).write_text('original-' + name)
        if enabled:
            (private / 'admin.ready').write_text('1')
            (private / 'mysql-admin.php').write_text('original-trait')
        (public / 'index.html').write_text('original-site')
        for name in ('install-admin.sh', 'rollback-admin.sh'):
            source = (root / 'hosting' / name).read_text()
            source = source.replace('/var/www/u3638340/data/escape-private', str(private))
            source = source.replace('/var/www/u3638340/data/www/escapeworkspaceru.ru', str(public))
            source = source.replace('php=/usr/bin/php', 'php=' + php)
            (bundle / name).write_text(source)
        subprocess.run(['bash', str(bundle / 'install-admin.sh')], check=True, capture_output=True)
        assert (private / 'mysql.php').read_bytes() == (bundle / 'escape-private/mysql.php').read_bytes()
        assert (public / 'admin/admin.js').is_file()
        assert (private / 'admin.ready').exists() == enabled
        assert (private / '.env').read_text() == 'original-.env'
        assert (private / 'config.php').read_text() == 'original-config.php'
        backup, = private.glob('admin-backup-*')
        # Simulate enabling the feature after deployment; first-install rollback must disable it.
        (private / 'admin.ready').write_text('1')
        subprocess.run(['bash', str(backup / 'rollback-admin.sh')], check=True, capture_output=True)
        assert (private / 'mysql.php').read_text() == 'original-mysql.php'
        assert (public / 'index.html').read_text() == 'original-site'
        assert (private / 'admin.ready').exists() == enabled
        assert (private / 'mysql-admin.php').exists() == enabled
        assert (private / 'photos/retained.webp').read_bytes() == b'photo-kept'
        # Invalid PHP must stop before touching any live files.
        source = bundle / 'escape-private/mysql.php'
        original = source.read_bytes()
        source.write_text('<?php invalid syntax !!!')
        failed = subprocess.run(['bash', str(bundle / 'install-admin.sh')], capture_output=True)
        assert failed.returncode != 0
        assert (private / 'mysql.php').read_text() == 'original-mysql.php'
        source.write_bytes(original)
print('Installer and rollback passed: first install, upgrade, config/photo preservation, invalid PHP refusal.')
