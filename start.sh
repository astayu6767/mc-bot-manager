#!/bin/sh
set -e

: "${PORT:=3000}"

if [ -z "$DATABASE_URL" ]; then
  echo "ERROR: DATABASE_URL is not set."
  echo "In Railway: service -> Variables -> New Variable -> Add Reference ->"
  echo "choose the PostgreSQL database's DATABASE_URL."
  exit 1
fi

echo ">> waiting for the database to accept connections..."
n=0
until node -e "
const { Client } = require('pg');
const c = new Client({ connectionString: process.env.DATABASE_URL });
c.connect().then(() => c.end()).then(() => process.exit(0)).catch(() => process.exit(1));
" 2>/dev/null; do
  n=$((n + 1))
  if [ "$n" -ge 30 ]; then
    echo "ERROR: database not reachable after 90s — check that the Postgres"
    echo "database exists in the same Railway project/environment."
    exit 1
  fi
  sleep 3
done

echo ">> database is up; pushing schema..."
npx drizzle-kit push --force

echo ">> starting MC Bot Manager on port $PORT"
exec npx next start -H 0.0.0.0 -p "$PORT"
