# Volari — VPS deploy runbook (Phase 0)

Deploys the **web shell** (Next.js) to `volari.fun` behind nginx, managed by
PM2. Phase 0 has no gameplay yet — this puts the scaffold landing page live and
proves the pipeline. The Colyseus realtime + Fastify API + PostgreSQL/Redis are
added from Phase 2 (see commented blocks in `ecosystem.config.cjs` and the
nginx conf).

> Run every command below in your **VPS terminal** (`root@srv1728105`).
> DNS is already set: `volari.fun` A record → `187.77.120.136` (this VPS).

---

## 0. Prerequisites (once)

```bash
node -v        # need >= 20; install via nvm or nodesource if older
corepack enable && corepack prepare pnpm@10.33.0 --activate   # gets pnpm
pm2 -v         # already present (you used it for mootopia)
nginx -v       # install if missing: apt install -y nginx
```

## 1. Retire the old mootopia server — SAFELY (back up, don't delete blindly)

```bash
# Stop + remove from PM2
pm2 stop mootopia-server || true
pm2 delete mootopia-server || true

# Back up the old app dir BEFORE removing anything. Adjust the path to wherever
# mootopia actually lives (check: pm2 describe mootopia-server | grep 'exec cwd').
OLD=/var/www/mootopia        # <-- set to the real path
tar czf /root/mootopia-backup-$(date +%F).tar.gz "$OLD" 2>/dev/null && \
  echo "backed up to /root/mootopia-backup-$(date +%F).tar.gz"

# Only after you've confirmed the backup, move (not delete) the old dir aside:
mv "$OLD" "${OLD}.retired" 2>/dev/null || true

pm2 save        # persist the new (empty) process list
```

> ⚠️ Do **not** `rm -rf` the old directory until the backup is verified and you
> are sure mootopia is truly retired. `mv … .retired` is reversible; `rm` is not.

## 2. Get the Volari code onto the VPS

```bash
mkdir -p /var/www && cd /var/www
git clone https://github.com/fourtisf/skyhaven.git volari   # repo still named 'skyhaven'
cd volari
git checkout claude/new-session-o48fvt                       # or main, once merged
```

For later updates: `cd /var/www/volari && git pull && pnpm install && pnpm --filter @volari/web build && pm2 reload volari-web`.

## 3. Configure env

```bash
cp .env.example .env
# Phase 0 web needs nothing secret. PostgreSQL/Redis/Helius come later.
```

## 4. Install + build the web shell

```bash
pnpm install --frozen-lockfile
pnpm --filter @volari/web build
```

## 5. Start with PM2

```bash
pm2 start deploy/ecosystem.config.cjs
pm2 save
pm2 startup        # run once so PM2 survives reboots (follow the printed command)
curl -s localhost:3000/api/health    # → {"status":"ok","service":"web",...}
```

## 6. nginx reverse proxy + HTTPS

```bash
cp deploy/nginx/volari.fun.conf /etc/nginx/sites-available/volari.fun
ln -sf /etc/nginx/sites-available/volari.fun /etc/nginx/sites-enabled/volari.fun
nginx -t && systemctl reload nginx

# HTTPS via Let's Encrypt (installs + auto-renews):
apt install -y certbot python3-certbot-nginx
certbot --nginx -d volari.fun -d www.volari.fun
```

Now `https://volari.fun` serves the Volari scaffold landing page.

---

## Rollback

```bash
pm2 delete volari-web
mv /var/www/mootopia.retired /var/www/mootopia    # restore old app dir
# re-add mootopia to PM2 the way it was started before, then: pm2 save
```

## What's NOT deployed yet (by design)

- **No game** — Phase 0 is a placeholder scene + health checks.
- **api / realtime / PostgreSQL / Redis** — uncomment in `ecosystem.config.cjs`
  + the nginx conf and provision the DB/cache from Phase 2 onward.
- Keep everything on **devnet**; no real `$VOLA` value or mainnet Volari Deeds
  until Phase 7 (anti-cheat + reconciliation) is reviewed (handoff §6/§10).
