# File Server

## Quick start
On any Linux machine / VM / WSL with Docker installed (no Docker yet? see step 1):
```bash
cd Local-FTP-Server        # the downloaded / cloned folder
bash setup.sh
```
On the first run it asks you to choose the **admin password** (12+ characters), creates `.env` with default
settings, starts everything and prints the address. Open it and log in as **admin**.

> If the folder already contains `database/filebrowser.db` (an existing setup), it does **not** ask — users and
> passwords come from that database, so log in with its admin password.

---

A self-contained web file server you can copy to any machine and start with Docker:

- **FileBrowser** web file manager with the **purple glass theme** (dark purple glass, network background)
- **Folder access** checkboxes in *Settings → User Management*: the admin ticks which folders each user can open
- **Optional FTP** server on the same files
- Everything (files, users, settings) lives in this one folder

```
Local-FTP-Server/
├── setup.sh                 ← run this once (and after moving to a new machine)
├── reset-admin-password.sh  ← forgot a password? run this
├── env.example             ← settings template → copy to .env
├── docker-compose.yml       ← the services (no need to edit)
├── nginx/default.conf       ← front door: adds Folder access, no stale caching
├── branding/                ← theme + Folder access script
├── data/                    ← YOUR FILES
└── database/                ← users, passwords, settings (created on first run)
```

---

## 1. Install Docker (once per machine)

**Debian / Ubuntu / Kali / WSL:**
```bash
sudo apt update && sudo apt install -y docker.io docker-compose
```
> On Ubuntu the Compose package may be `docker-compose-v2` instead. Check with `docker compose version`.

```bash
sudo systemctl enable --now docker
```
Optional — use Docker without `sudo` (log out and back in afterwards; gives root-level access):
```bash
sudo usermod -aG docker $USER
```

> **WSL only:** `/etc/wsl.conf` must contain `[boot]` / `systemd=true`, then run `wsl --shutdown` in Windows and reopen.

---

## 2. Copy the folder and configure

Copy/download the folder to the machine (git clone, GitHub "Download ZIP", USB, `scp -r`…).
Nothing needs editing first — `bash setup.sh` creates `.env` and asks for the admin password.

Optional: to change settings **before** the first run, create `.env` yourself:
```bash
cp env.example .env && nano .env
```
Settings in `.env`:

| Setting | What |
|---|---|
| `ADMIN_PASSWORD` | web admin password, **12+ characters** |
| `PUID` / `PGID` | your user/group numbers — run `id` (usually 1000/1000) |
| `WEB_PORT` | web port, default 8090 |
| `FTP_ENABLED` | `yes` to also run FTP (see section 6) |

---

## 3. Run setup

```bash
bash setup.sh
```
It prepares the folders, creates the database, sets the admin password from `.env`, turns on the theme,
starts everything and checks it works. At the end it prints the address, e.g.
```
Web:    http://192.168.1.10:8090
Login:  admin / the ADMIN_PASSWORD from .env
```
Open it, log in as **admin**, and change the password in **Settings → Profile** if you like.

`setup.sh` is safe to run again — it never resets existing users or passwords.

---

## 4. Users and folder access

**Create a user:** Settings → User Management → **New** → username + password (12+ characters).

**Choose their folders** (same page, under Password):
1. Tick **Use folder checkboxes**.
2. Tick each folder they may open — e.g. their own `Krishna` folder and `COMMON FOLDER`.
   **All folders** = everything, including folders created later.
3. Click **Save** at the bottom (FileBrowser asks for your admin password).

Everything not ticked is invisible to that user. Dot-files (`.DS_Store` etc.) are hidden for them automatically.
Untick to take access away. Admin accounts always see everything.

**What they may do** (upload, delete, rename, share, download) is set in **Permissions** on the same page —
it applies to every folder they can see. Untick Create/Rename/Modify/Delete for a read-only user.

Only **top-level folders** (directly inside `data/`) appear as checkboxes; sub-folders come with their parent.
Create folders as admin with **New folder** in My files.

**Overview of who can open what:** `http://<address>:8090/static/img/access.html` (admin login needed) —
a grid of users × folders, also editable.

> If a user shows *"hand-written Scope/Rules"*, their access was set the old way. Tick **Use folder checkboxes**
> to switch them to checkboxes (their old rules are replaced on Save).

---

## 5. Everyday commands

Run inside the `Local-FTP-Server` folder (add `sudo` if you didn't do the optional docker-group step):

| Task | Command |
|---|---|
| Start | `docker compose up -d` (with FTP: `docker compose --profile ftp up -d`) |
| Stop | `docker compose --profile ftp down` |
| Status | `docker compose ps` |
| Logs | `docker compose logs --tail 50 filebrowser` (or `web`, `ftp`) |
| Restart | `docker compose restart` |
| Forgot a password | `bash reset-admin-password.sh` (admin) or `bash reset-admin-password.sh Krishna` |

Containers start again automatically after a reboot.

---

## 6. FTP (optional)

In `.env`:
```
FTP_ENABLED=yes
HOST_IP=192.168.1.10                     # this machine's LAN IP (hostname -I)
FTP_USERS=ftpadmin|Change-Me-Ftp-123|/ftp/data|1000 krishna|Krishna-Pass-1|/ftp/data/Krishna|1000
```
- `/ftp/data` = the whole `data/` folder; `/ftp/data/Krishna` = only that folder.
- Last number = your `PUID`. No `|` or spaces in passwords.
- FTP logins are separate from web logins and can only be locked to **one** folder each.

Then run `bash setup.sh` again. Connect with FileZilla / WinSCP: host = `HOST_IP`, port 21, plain FTP.
Open ports **21** and **21000–21010** (TCP) in the firewall, e.g. `sudo ufw allow 21/tcp && sudo ufw allow 21000:21010/tcp`.

> FTP sends passwords unencrypted — LAN / VPN only.

---

## 7. Back up / move to another machine

Everything is in this folder:
```bash
docker compose --profile ftp down
```
```bash
sudo tar czf fileserver-backup-$(date +%F).tgz -C .. Local-FTP-Server
```
On the new machine: install Docker (step 1), extract, check `PUID`/`PGID`/`HOST_IP` in `.env`, run `bash setup.sh`.
Users, passwords, folder access and theme come along.

---

## 8. Reaching it from other PCs when running in WSL (Windows)

By default only the Windows PC itself can open `localhost:8090`. On Windows 11, create/edit
`C:\Users\<you>\.wslconfig`:
```
[wsl2]
networkingMode=mirrored
```
Run `wsl --shutdown` in PowerShell, reopen the terminal, and allow the ports (PowerShell **as Administrator**):
```powershell
New-NetFirewallRule -DisplayName "File Server" -Direction Inbound -Protocol TCP -LocalPort 8090,21,21000-21010 -Action Allow
```
Other PCs then use `http://<Windows PC IP>:8090`.

---

## 9. Troubleshooting

| Problem | Fix |
|---|---|
| `Cannot connect to the Docker daemon` | Docker not installed/running → step 1. |
| `permission denied … docker.sock` | Use `sudo`, or the optional docker-group step. |
| setup.sh: "did not start" / container keeps restarting | Folder ownership: `sudo chown -R 1000:1000 data database` (your PUID:PGID), then `bash setup.sh`. Details: `docker compose logs filebrowser`. |
| No theme / no *Folder access* box | Press **Ctrl+F5**. Then run `bash setup.sh` again. |
| Can't log in | `bash reset-admin-password.sh` |
| Password change in web does nothing | Must be 12+ characters. |
| `port is already allocated` | Change `WEB_PORT` in `.env`, run `bash setup.sh`. |
| User sees nothing | No folders ticked for them, or the folder doesn't exist in `data/`. |
| FTP connects but listing hangs | Wrong `HOST_IP`, or ports 21000–21010 blocked. |

---

## Good to know

- **FileBrowser is end-of-life**: the project was archived on 2026-09-01 (no more updates or security fixes).
  Keep this on your LAN / VPN — **don't expose it directly to the internet**.
- Plain HTTP. For access from outside, put it behind an HTTPS reverse proxy (or VPN).
- Not included here (they need Samba on the host): the Windows `\\server` share and the Samba activity log.
