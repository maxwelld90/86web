# 86Web — Quick Start Guide

Get 86Web up and running in under 5 minutes.

---

## Prerequisites

- **Docker Engine 24+** and **Docker Compose v2**
- **Linux host** (amd64 or arm64)
- For group networking: `bridge` and `tun` kernel modules loaded on the host

---

## Steps

### 1. Clone the repository

```bash
git clone <repo> /srv/86web
cd /srv/86web
```

### 2. Create a service user

Create a dedicated system user and group so containers don't run as your personal account:

```bash
sudo groupadd -r 86web
sudo useradd -r -g 86web -s /usr/sbin/nologin -d /srv/86web 86web
```

Note the UID and GID — you'll need them for the next step:

```bash
id 86web    # e.g. uid=990(86web) gid=990(86web)
```

### 3. Create your `.env` file

```bash
cp .env.example .env
```

Open `.env` in your editor and set at minimum:

| Variable | What to set |
|---|---|
| `PUID` | UID of the `86web` user (from `id 86web`) |
| `PGID` | GID of the `86web` group (from `id 86web`) |
| `ADMIN_PASSWORD` | A strong password for the admin account |
| `APP_SECRET_KEY` | A long random string (keeps sessions alive across restarts) |

Everything else has sensible defaults. See the full [Environment Variables](README.md#environment-variables) reference in the README.

### 4. Initialise the data directory

```bash
sudo bash scripts/init-data.sh
```

This creates the required subdirectory tree (`vms/`, `roms/`, `config/`, `cache/`, `user_images/`) under `DATA_PATH` and sets ownership to `PUID:PGID`.

### 5. Start the stack

```bash
docker compose up -d
```

First run will build the containers and download the latest 86Box binary + ROM files. Watch progress with:

```bash
docker compose logs -f
```

### 6. Open the UI

Navigate to **http://localhost** (or `http://<host>:<WEB_PORT>` if you changed `WEB_PORT`).

Log in with:
- **Username:** `admin` (or whatever you set in `ADMIN_USERNAME`)
- **Password:** the password you set in `ADMIN_PASSWORD`

### 7. Create your first VM

1. Click **New VM**
2. Pick a machine type, CPU, RAM, and video card
3. Attach a boot disk image (upload via the **Media** page, or use the shared library)
4. Click **Start** — the VNC console opens in your browser

---

## Optional: HTTPS

1. Set `SSL_CERTS_DIR` in `.env` to a directory containing `fullchain.pem` and `privkey.pem`
2. Set `SERVER_NAME` to your domain
3. Uncomment the HTTPS port mapping in `docker-compose.yml`
4. Restart: `docker compose up -d`

## Optional: macvlan (LAN IP)

Give 86Web its own IP address on your local network — no port forwarding required:

```bash
docker network create -d macvlan \
  --subnet=192.168.1.0/24 \
  --gateway=192.168.1.1 \
  -o parent=eth0 \
  netpub

docker compose -f docker-compose.yml -f docker-compose.macvlan.yml up -d
```

Edit `docker-compose.macvlan.yml` to set the static IP.

---

## Stopping / Restarting

```bash
docker compose down      # stop all containers
docker compose up -d     # start again (data is preserved)
```

## Updating

```bash
git pull
docker compose build
docker compose up -d
```

86Box itself is updated automatically on container start (or manually from the Settings page).

---

For the full reference — architecture, all environment variables, LDAP setup, group networking details, and more — see the [README](README.md).
