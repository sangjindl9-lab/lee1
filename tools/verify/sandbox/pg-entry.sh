#!/bin/bash
set -e
mkdir -p "$PGDATA" /run/postgresql; chown -R postgres:postgres "$PGDATA" /run/postgresql; chmod 700 "$PGDATA"
PW=$(cat "$POSTGRES_PASSWORD_FILE")
if [ ! -s "$PGDATA/PG_VERSION" ]; then
  su postgres -c "/usr/lib/postgresql/16/bin/initdb -D $PGDATA -U postgres -E UTF8 --locale=C.UTF-8 --auth-local=trust --auth-host=scram-sha-256" >/dev/null
  echo "host all all 0.0.0.0/0 scram-sha-256" >> $PGDATA/pg_hba.conf
  su postgres -c "/usr/lib/postgresql/16/bin/pg_ctl -D $PGDATA -o '-c listen_addresses= -p 5432' -w start" >/dev/null
  su postgres -c "/usr/lib/postgresql/16/bin/psql -h /var/run/postgresql -p 5432 -v ON_ERROR_STOP=1 -c \"CREATE ROLE $POSTGRES_USER LOGIN PASSWORD '$PW'\" -c \"CREATE DATABASE $POSTGRES_DB OWNER $POSTGRES_USER\"" >/dev/null
  su postgres -c "/usr/lib/postgresql/16/bin/pg_ctl -D $PGDATA -m fast -w stop" >/dev/null
fi
exec su postgres -c "/usr/lib/postgresql/16/bin/postgres -D $PGDATA -c listen_addresses='*'"
