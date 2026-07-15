# Operational checklist (post-launch hygiene)

Things that can't be done from code — they need someone with access to GitHub / Neon / Render / Cloudflare / a calendar.

Run through these once at your pace. Once done, you're at the steady-state operational baseline this audit was designed to produce.

---

## 1 — Delete the old self-hosted GitHub runner

**Why:** The `fly-deploy.yml` and `render-keepalive.yml` workflows used to run on a self-hosted machine. Both have been moved to GitHub-hosted `ubuntu-latest` runners (commit [cd8e97d](https://github.com/Juadebfm/global-express-backend/commit/cd8e97d)). The old self-hosted runner is now dead weight — but it's still registered with this repo. As long as it sits there with a valid token, it can pick up any future job that gets queued to `self-hosted` (or that someone accidentally targets at it). Deleting it eliminates the attack surface.

**Steps (2 minutes):**

1. Go to **https://github.com/Juadebfm/global-express-backend/settings/actions/runners**
2. Find the listed self-hosted runner (likely your laptop or a small VM you set up earlier)
3. Click the **⋯** menu → **Remove runner**
4. Follow the prompt (you may need to also run a `./config.sh remove` on the runner host to deregister it cleanly — GitHub will give you the exact command)

**Done when:** the GitHub runners page shows zero self-hosted runners listed.

---

## 2 — Share the Turnstile site key with the FE team

**Why:** FE needs the **site key** to render the Turnstile widget on the 5 public forms. The site key is safe to expose (it's in the HTML) — only the *secret key* must stay private (already on Render).

**Steps (2 minutes):**

1. Go to **https://dash.cloudflare.com/?to=/:account/turnstile**
2. Open the widget you created earlier (named something like `global-express-backend`)
3. Copy the **Site Key** (starts with `0x4AAAAAAA…`). NOT the secret key.
4. Share with the FE team via your preferred channel (1Password shared vault, Notion page, or DM).

**Send them this snippet alongside:**

> ```
> Cloudflare Turnstile site key for global-express:
> 0x4AAAAAAA...
>
> Integration: see docs/fe-handover.md § 4 in the backend repo.
> Test keys for local dev: https://developers.cloudflare.com/turnstile/troubleshooting/testing/
> ```

**Done when:** FE confirms they have the key and the widget renders on at least one form.

---

## 3 — Confirm staff UI gates file display on `scan.status === 'clean'`

**Why:** AV scanning (VirusTotal) is wired on the backend, but the staff dashboard has to actually check the scan verdict before opening a user-uploaded file. Without that gate, a malicious file flagged by VT but still cached in the staff browser session could compromise a staff machine.

**Steps (FE acceptance):**

1. Pick any staff page that opens an uploaded file (e.g. "review claim", "verify payment receipt").
2. Confirm the page calls `GET /api/v1/internal/file-scans/status?r2Key=...` before rendering the file.
3. Test all 5 status branches (see [`docs/fe-handover.md § 6`](fe-handover.md#6--file-scan-gating-before-opening-uploaded-files)):
   - `pending` → placeholder, no file shown, auto-refresh
   - `clean` → file shown
   - `malicious` → red warning, file NOT shown
   - `error` → "scan failed" notice, treat as untrusted
   - `skipped` → small caveat (amber dot is fine)

**Done when:** FE has tested all 5 branches and merged the gating PR.

---

## 4 — Spin up a Neon dev branch so local dev stops writing to prod

**Why:** Right now `.env` (your local dev environment) and Render production both point at the same Neon database (`ep-damp-scene-aiu55lzj.c-4.us-east-1.aws.neon.tech`). This means every time you run a seed script, the backfill script, or just run the dev server, it writes to the production DB. Pre-launch this is mostly harmless, but it's a foot-gun once real customer data lands.

Neon's "Branches" feature spins up a separate copy off main with one click — same data, isolated writes.

**Steps (5 minutes):**

1. Go to **https://console.neon.tech** → your project
2. Sidebar → **Branches** → **+ Create branch**
3. Name: `dev` (or `local-dev`)
4. Parent: `main` (or whichever is current production)
5. Choose **Create branch from latest data** — this copies a snapshot
6. Once created, click the new branch → copy its **Connection string**
7. In your local `.env`, replace the `DATABASE_URL` value with this new dev-branch URL. **Keep the prod URL in `.env.render` or 1Password** so you can switch back if needed.
8. Restart your local server.

**Done when:** running a `seed:*` script locally writes to the dev branch, NOT the production branch. Confirm by checking the Neon dashboard "Operations" tab — recent writes should appear under the dev branch, not main.

**Bonus:** Once you have a dev branch, you can also run migrations against it first as a dry run before applying them to prod:
```bash
# Switch DATABASE_URL to dev branch, then:
npm run db:migrate:status
npm run db:migrate
# If it works, switch back to prod and run the same ledger-aware command.
```

---

## 5 — Calendar reminder: rotate `ENCRYPTION_KEY` in 12 months

**Why:** `ENCRYPTION_KEY` encrypts every PII column. Rotation policy is documented in [`docs/key-rotation-runbook.md`](key-rotation-runbook.md). Industry standard is annual rotation. Without a reminder, this slips and the key sits forever — that's the path to "we got breached and the same key was used for 5 years."

**Steps (30 seconds):**

Add a recurring calendar event:

- **Title:** Rotate `ENCRYPTION_KEY` (Global Express backend)
- **Date:** 12 months from today
- **Repeat:** Yearly
- **Description / Notes:**
  > See `docs/key-rotation-runbook.md` in the global-express-backend repo. The dual-key migration procedure is mandatory — never rotate without re-encrypting historical rows. Block ~4 hours and a maintenance window.

**While you're at it,** add a second annual reminder for: `JWT_SECRET`, `CLERK_SECRET_KEY`, `PAYSTACK_SECRET_KEY`, `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY`. These don't need a dual-key migration — just generate new, swap in env, redeploy. Pin them all to the same date so you do one quarterly rotation pass instead of forgetting.

**Done when:** the calendar event exists.

---

## 6 — Pick an OpenTelemetry exporter (when you have traffic worth tracing)

**Why:** OTel is fully wired in code (env-gated by `OTEL_EXPORTER_OTLP_ENDPOINT`). It just needs an endpoint to ship to. Without traces, when a request is slow you have to grep logs by `X-Request-ID` — workable but slow. With traces, you get a flamegraph showing exactly which DB query / external API call was the slow link.

**Don't do this on launch day** — wait until you have ≥ 50 requests/minute consistently. Below that, you'll be paying for an observability vendor to look at noise.

**When you're ready (~10 minutes):**

Pick a vendor based on price and feature fit:

| Vendor | Free tier | Why pick it |
|---|---|---|
| **Grafana Cloud** | Generous free tier (50 GB/mo traces) | Best for cost-conscious. Standard PromQL + Loki integration. |
| **Honeycomb** | 20M events/mo free | Best UX for trace exploration. Industry-leading "BubbleUp" feature for diagnosing slow queries. |
| **Datadog** | 14-day trial, $$$ paid | Best for teams that want one vendor for traces + metrics + logs + APM. Expensive at scale. |
| **Tempo (self-hosted)** | Free | Best if you already run Grafana / want zero vendor lock-in. |

Once you've picked one:

1. Sign up, get the OTLP endpoint URL and any required auth header
2. In Render dashboard → environment, set:
   ```
   OTEL_EXPORTER_OTLP_ENDPOINT=https://<your-endpoint>/v1/traces
   OTEL_SERVICE_NAME=global-express-backend
   ```
3. If the vendor needs an auth header (most do), Render lets you set `OTEL_EXPORTER_OTLP_HEADERS` too — the OTel SDK reads it automatically
4. Restart the service. Traces should start flowing within ~1 minute.

**Done when:** you can search for a specific `X-Request-ID` in your tracing UI and see the full request flow.

---

## Summary checklist

- [ ] 1. Delete old self-hosted GitHub runner
- [ ] 2. Share Turnstile site key with FE team
- [ ] 3. FE confirms staff UI gates file display on `scan.status === 'clean'`
- [ ] 4. Spin up Neon dev branch + switch local `.env`
- [ ] 5. Calendar reminder for `ENCRYPTION_KEY` rotation (12 months)
- [ ] 6. (When traffic warrants) Pick + wire OpenTelemetry exporter

Items 1, 2, 4, 5 take **~10 minutes total combined**. Items 3, 6 are deferred until they're actually relevant.
