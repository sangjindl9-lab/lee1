"""관리자 백업/복구: python scripts_backup.py backup out.tar.gz | restore in.tar.gz (DB + 원본/처리본 스토리지)."""
import subprocess, sys, tarfile
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from app.config import settings  # noqa: E402

cmd, path = sys.argv[1], Path(sys.argv[2])
if cmd == "backup":
    with tarfile.open(path, "w:gz") as t:
        t.add(settings.storage_dir, arcname="storage")
        if settings.database_url.startswith("postgresql"):
            dump = subprocess.run(["pg_dump", "--dbname=" + settings.database_url.replace("+psycopg", "")], capture_output=True, check=True).stdout
            (settings.storage_dir / "_pg.sql").write_bytes(dump)
            t.add(settings.storage_dir / "_pg.sql", arcname="_pg.sql")
    print("backup ->", path)
elif cmd == "restore":
    with tarfile.open(path) as t:
        t.extractall(settings.storage_dir.parent, filter="data")
    print("restored storage. PostgreSQL 은 _pg.sql 을 psql 로 복원하십시오.")
