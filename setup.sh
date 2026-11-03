#!/bin/bash
# File Server — first-time setup (safe to run again: it never resets users or the admin password).
#   1. checks Docker and .env
#   2. prepares data/ and database/ (ownership)
#   3. first run only: lets FileBrowser create its database, then sets the admin password from .env
#   4. turns on the theme, starts everything (FTP too if FTP_ENABLED=yes) and checks the page answers
set -euo pipefail
cd "$(dirname "$0")"

say()  { printf '\033[1;35m==>\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31mERROR:\033[0m %s\n' "$*" >&2; exit 1; }

# ---- .env (created here on the first run if it doesn't exist) ----
env_set() {   # env_set KEY VALUE — replaces or adds KEY=VALUE in .env (value may contain any character)
  K="$1" V="$2" awk 'BEGIN{k=ENVIRON["K"]; v=ENVIRON["V"]; done=0}
    $0 ~ "^[[:space:]]*" k "=" { print k "=" v; done=1; next } { print }
    END{ if(!done) print k "=" v }' .env > .env.tmp && cat .env.tmp > .env && rm -f .env.tmp
}
env_get() { sed -n "s/^[[:space:]]*$1=//p" .env | tail -n1 | sed 's/^["'\'']//; s/["'\'']$//'; }
NEW_ENV=0
if [ ! -f .env ]; then
  ( umask 077
    if [ -f env.example ]; then cp env.example .env; else
      cat > .env <<'DEFAULTS'
# File Server settings (created by setup.sh) — see README.md
ADMIN_PASSWORD=
SITE_NAME=File Server
WEB_PORT=8090
PUID=1000
PGID=1000
FTP_ENABLED=no
HOST_IP=
FTP_USERS=
FTP_PASV_MIN=21000
FTP_PASV_MAX=21010
DEFAULTS
    fi )
  chmod 600 .env
  NEW_ENV=1
  if [ "$(id -u)" != 0 ]; then env_set PUID "$(id -u)"; env_set PGID "$(id -g)"; fi
  IP0=$(hostname -I 2>/dev/null | awk '{print $1}'); [ -n "$IP0" ] && env_set HOST_IP "$IP0"
fi
ADMIN_PASSWORD=$(env_get ADMIN_PASSWORD)
# the admin password is only needed before the database exists (first install)
if [ ! -s database/filebrowser.db ] && { [ ${#ADMIN_PASSWORD} -lt 12 ] || [ "$ADMIN_PASSWORD" = "Change-Me-Admin-123" ]; }; then
  [ -t 0 ] || fail "Set ADMIN_PASSWORD (12+ characters, not the example) in .env, or run 'bash setup.sh' in a terminal to be asked."
  say "First run — choose the web admin password (12+ characters, used to log in as 'admin')"
  while :; do
    read -rsp "   Admin password: " P1; echo
    read -rsp "   Repeat:         " P2; echo
    [ "$P1" != "$P2" ] && { echo "   Passwords do not match, try again."; continue; }
    [ ${#P1} -lt 12 ] && { echo "   Too short (12+ characters), try again."; continue; }
    [ "$P1" = "Change-Me-Admin-123" ] && { echo "   Please don't use the example password."; continue; }
    break
  done
  env_set ADMIN_PASSWORD "$P1"; ADMIN_PASSWORD=$P1
  say "Saved to .env (edit .env later for port, site name or FTP, then run bash setup.sh again)"
elif [ "$NEW_ENV" = 1 ]; then
  say "Created .env with default settings"
fi
SITE_NAME=$(env_get SITE_NAME); SITE_NAME=${SITE_NAME:-File Server}
WEB_PORT=$(env_get WEB_PORT); WEB_PORT=${WEB_PORT:-8090}
PUID=$(env_get PUID); PUID=${PUID:-1000}
PGID=$(env_get PGID); PGID=${PGID:-1000}
FTP_ENABLED=$(env_get FTP_ENABLED)

# ---- docker ----
command -v docker >/dev/null || fail "Docker is not installed (README step 1)."
SUDO=""
if ! docker info >/dev/null 2>&1; then
  sudo docker info >/dev/null 2>&1 || fail "Docker is not running. Start it: sudo systemctl enable --now docker"
  SUDO="sudo"
fi
DC="$SUDO docker compose"
$DC version >/dev/null 2>&1 || fail "'docker compose' is missing (install the docker-compose / docker-compose-plugin package)."
PROFILE=""; [ "${FTP_ENABLED,,}" = "yes" ] && PROFILE="--profile ftp"

# ---- folders ----
say "Preparing data/ and database/ for uid:gid $PUID:$PGID"
mkdir -p data database
if [ "$(stat -c %u:%g data)" != "$PUID:$PGID" ] || [ "$(stat -c %u:%g database)" != "$PUID:$PGID" ]; then
  sudo chown -R "$PUID:$PGID" data database
fi

fb() { $DC run --rm --no-deps --entrypoint filebrowser filebrowser "$@" -d /database/filebrowser.db >/dev/null \
       || fail "filebrowser $1 $2 failed (see output above)"; }

# ---- first run: database + admin ----
if [ ! -s database/filebrowser.db ]; then
  say "First run: creating the FileBrowser database"
  $DC up -d filebrowser
  for i in $(seq 1 60); do
    st=$($SUDO docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' fileserver-filebrowser 2>/dev/null || true)
    [ "$st" = "healthy" ] && break
    [ "$i" = 60 ] && { $SUDO docker logs --tail 30 fileserver-filebrowser; fail "FileBrowser did not start (log above)."; }
    sleep 1
  done
  $DC stop filebrowser >/dev/null
  say "Setting the admin password from .env"
  fb users update admin --password "$ADMIN_PASSWORD"
  FIRST=1
else
  say "Existing database found — users and passwords are kept"
  $DC stop filebrowser >/dev/null 2>&1 || true
  FIRST=0
fi

# ---- theme (every run) ----
say "Turning on the theme ($SITE_NAME)"
fb config set --branding.files /branding --branding.name "$SITE_NAME" --branding.theme dark

# ---- start ----
say "Starting${PROFILE:+ (with FTP)}"
$DC $PROFILE up -d

# ---- check ----
ok=""
for i in $(seq 1 30); do
  page=$(curl -s -m 3 "http://127.0.0.1:$WEB_PORT/" || true)
  if echo "$page" | grep -q 'fb-folders.js' && echo "$page" | grep -q '"CSS":true'; then ok=1; break; fi
  sleep 1
done
[ -n "$ok" ] || { $DC ps; fail "Web page not answering correctly on port $WEB_PORT — see README troubleshooting."; }

IP=$(hostname -I 2>/dev/null | awk '{print $1}')
echo
say "Done."
echo "   Web:    http://${IP:-localhost}:$WEB_PORT   (on this machine: http://localhost:$WEB_PORT)"
[ "$FIRST" = 1 ] && echo "   Login:  admin / the ADMIN_PASSWORD from .env  — change it after logging in (Settings > Profile)"
[ -n "$PROFILE" ] && echo "   FTP:    ftp://${IP:-<this-ip>}  (logins from FTP_USERS in .env)"
echo "   Folder access per user: Settings > User Management > (user) > Folder access"
