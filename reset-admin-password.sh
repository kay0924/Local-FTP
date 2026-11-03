#!/bin/bash
# Sets a new password for a web user (default: admin). FileBrowser stops for a few seconds.
#   bash reset-admin-password.sh            → asks for a new admin password
#   bash reset-admin-password.sh Krishna    → same for user Krishna
set -euo pipefail
cd "$(dirname "$0")"
USER_NAME=${1:-admin}
SUDO=""; docker info >/dev/null 2>&1 || SUDO="sudo"
read -rsp "New password for $USER_NAME (12+ characters): " P1; echo
read -rsp "Repeat: " P2; echo
[ "$P1" = "$P2" ] || { echo "Passwords do not match"; exit 1; }
[ ${#P1} -ge 12 ] || { echo "Must be at least 12 characters"; exit 1; }
$SUDO docker compose stop filebrowser
$SUDO docker compose run --rm --no-deps --entrypoint filebrowser filebrowser users update "$USER_NAME" --password "$P1" -d /database/filebrowser.db >/dev/null \
  && echo "Password changed for $USER_NAME" || echo "Failed — does user '$USER_NAME' exist? (names are case-sensitive)"
$SUDO docker compose up -d filebrowser
