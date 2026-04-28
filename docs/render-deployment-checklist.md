# Render Deployment Checklist (Global Express Backend)

Use this to deploy the backend on Render with the existing Neon database and external services.

## 1) Prerequisites

- [ ] Repository is pushed to GitHub (`main` branch up to date).
- [ ] You have access to Render dashboard.
- [ ] You have all required environment variable values from your current `.env`.

## 2) One-Time Setup (Blueprint)

- [ ] In Render, click `New` -> `Blueprint`.
- [ ] Select this GitHub repo: `Juadebfm/global-express-backend`.
- [ ] Confirm Render detects [`render.yaml`](/Users/macbookpro/Documents/GitHub/global-express-backend/render.yaml).
- [ ] Choose a service plan you can afford (free/starter based on account availability).
- [ ] Click `Apply`.

## 3) Environment Variables (Required)

Set these in Render service env vars (or during blueprint creation):

- [ ] `DATABASE_URL`
- [ ] `CLERK_SECRET_KEY`
- [ ] `CLERK_PUBLISHABLE_KEY`
- [ ] `R2_ACCOUNT_ID`
- [ ] `R2_ACCESS_KEY_ID`
- [ ] `R2_SECRET_ACCESS_KEY`
- [ ] `R2_BUCKET_NAME`
- [ ] `R2_PUBLIC_URL`
- [ ] `RESEND_API_KEY`
- [ ] `RESEND_FROM_EMAIL`
- [ ] `RESEND_FROM_NAME`
- [ ] `PAYSTACK_SECRET_KEY`
- [ ] `PAYSTACK_PUBLIC_KEY`
- [ ] `JWT_SECRET` (minimum 32 chars)
- [ ] `ENCRYPTION_KEY` (64-char hex)
- [ ] `CORS_ORIGINS` (comma-separated frontend origins, include your production FE URL)

## 4) Environment Variables (Recommended / Optional)

- [ ] `CLERK_WEBHOOK_SECRET` (needed if Clerk webhooks are used)
- [ ] `JWT_EXPIRES_IN` (default in blueprint is `8h`)
- [ ] `TERMII_API_KEY` / `TERMII_SENDER_ID` / `TERMII_CHANNEL` (if SMS/WhatsApp is used)
- [ ] `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` (if web push is used)

## 5) Deploy Behavior in This Repo

- Build command: `npm ci && npm run build`
- Pre-deploy command: `npm run db:migrate`
- Start command: `npm start`
- Health check path: `/health`

## 6) Post-Deploy Verification

- [ ] Render service status is `Live`.
- [ ] `GET https://<your-render-service>.onrender.com/health` returns:

```json
{
  "status": "ok",
  "timestamp": "2026-04-26T00:00:00.000Z"
}
```

- [ ] `GET https://<your-render-service>.onrender.com/api/v1/public/gallery` returns `success: true`.
## 7) Frontend Switch

- [ ] Update frontend API base URL to:
  - `https://<your-render-service>.onrender.com/api/v1`
- [ ] Ensure this exact frontend origin is included in backend `CORS_ORIGINS`.
- [ ] Redeploy frontend.

## 8) Troubleshooting Quick Checks

- [ ] If startup fails immediately, check missing env vars in Render logs.
- [ ] If deployment fails on migrate, verify `DATABASE_URL` connectivity and credentials.
- [ ] If FE gets CORS errors, confirm exact protocol/domain in `CORS_ORIGINS`.
- [ ] If file uploads fail, re-check `R2_*` credentials and bucket/public URL.

## 9) Free-Tier Cold Start Mitigation (Optional)

- [ ] Configure GitHub Actions secret `RENDER_HEALTHCHECK_URL` with:
  - `https://<your-render-service>.onrender.com/health`
- [ ] Ensure workflow file exists:
  - `.github/workflows/render-keepalive.yml`
- [ ] Ensure a self-hosted GitHub runner is online for this repository.
- [ ] Optional setup guide:
  - `docs/self-hosted-runner-keepalive.md`
- [ ] Run it once manually via Actions tab (`Render Keepalive` -> `Run workflow`).
- [ ] Confirm scheduled pings run every 30 minutes.
- [ ] Note: Free Render services idle after ~15 minutes of no traffic, so 30/60-minute schedules are for periodic health checks, not full keep-awake behavior.
