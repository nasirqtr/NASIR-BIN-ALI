# Nasir Bin Ali Al-Kuwari & Sons Garage W.L.L.

Premium responsive garage website for Doha, Qatar, based on the owner's supplied name, signboard, services and updated contact number.

**Business name (English):** NASIR BIN ALI AL-KUWARI & SONS GARAGE W.L.L.  
**Arabic:** كراج ناصر بن علي الكواري وأولاده ذ.م.م  
**Phone:** +974 5524 1833  
**Location:** Street 19, Gate 3, Industrial Area, Doha, Qatar

## Files

- `index.html` — complete bilingual-brand homepage, eight service sections, vehicle selection, forms, and map
- `style.css` — mobile-first responsive design and animations (no CSS frameworks)
- `script.js` — navigation, selectors, API requests, form checks
- `worker.js` — Cloudflare Worker with Turnstile and D1
- `schema.sql` — creates D1 `appointments` and `quotes` tables
- `wrangler.jsonc` — sample Cloudflare Worker configuration (replace placeholders)
- `assets/` — local service illustrations, real uploaded signboard, SVG icons
- `_headers` — basic security headers for Cloudflare Pages

## Frontend deployment (Cloudflare Pages)

1. Upload the contents of the **frontend ZIP** through Cloudflare Pages > Create project > Direct Upload. The ZIP must have `index.html` at its root, which the supplied frontend ZIP does.
2. Cloudflare will assign a site URL such as `https://your-site.pages.dev`. Keep this URL; do not assume the example above is your actual domain.
3. In `script.js`, replace `https://REPLACE-WITH-YOUR-WORKER.workers.dev` with your real deployed Worker URL. Re-upload the frontend after the backend URL is known.
4. Update the Google Map search link/iframe if you have a verified exact Maps pin. Current links open a search for the owner-provided garage name/address, **not** the previously supplied unrelated map pin.

## Create and deploy the backend (Cloudflare Workers + D1)

From the **complete project folder** on your own PC:

```powershell
npx wrangler@latest login
npx wrangler@latest d1 create nasir-garage-db
```

Copy the returned **database_id** into `wrangler.jsonc`, replacing `REPLACE_WITH_YOUR_D1_DATABASE_ID`.

Initialize tables:

```powershell
npx wrangler@latest d1 execute nasir-garage-db --remote --file=./schema.sql
```

In `wrangler.jsonc`, replace `ALLOWED_ORIGINS` with your exact Pages URL. For several exact origins, provide comma-separated values.

Create a Cloudflare Turnstile widget for your site. Replace `REPLACE_WITH_YOUR_TURNSTILE_SITE_KEY` in the two `index.html` elements with the site's public key. Store the secret as a Worker secret (do not place the secret in frontend code):

```powershell
npx wrangler@latest secret put TURNSTILE_SECRET
npx wrangler@latest deploy
```

The Worker accepts:

- `GET /api/health`
- `POST /api/book`
- `POST /api/quote`

The front end includes the selected service in each appointment's `notes` or quote's `issue`, so it works with the original appointment/quote SQL structure. All requests are inserted as **pending**; a submitted request is not a confirmed booking.

## Owner checks before publication

- Confirm the garage's opening hours: **no hours were supplied, so none have been invented**.
- Confirm warranty/guarantee terms. The owner asked for a 100% service-guarantee message; this website advises customers to confirm the exact terms before authorizing repairs.
- Confirm whether +974 5524 1833 has WhatsApp enabled (mobile link assumes it does).
- Confirm exact Maps pin and building entrance before publishing; the map currently searches the owner-supplied name and address.
- Confirm workshop accepts all the advertised repairs for a specific make and model. Manufacturer chips are an enquiry mechanism only, not a certification claim.
- Confirm prices with the owner: no prices have been invented.
- The uploaded real signboard shows a different telephone number (44503228). The website uses the **updated** number explicitly provided by the owner: +974 5524 1833.
- The service images and two hero SUVs are **illustrative**, not authentic interior photographs of this business. The real signboard is included in `assets/real-signboard.webp`.
- Add a legally appropriate privacy notice/policy for stored names, phone numbers and vehicle details, and establish staff access/deletion procedures.
- Consider adding staff notification or an authenticated admin dashboard. The provided code stores data but does **not** email or WhatsApp staff automatically.

## Quick local preview

Open `index.html` in a browser. The static page is fully visible without the Worker. Booking and quote buttons show a configuration notice until the Worker URL and Turnstile site key are added. To test backend requests live, deploy to Cloudflare first.

## Database schema

```sql
CREATE TABLE IF NOT EXISTS appointments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reference TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  vehicle TEXT NOT NULL,
  preferred_date TEXT NOT NULL,
  preferred_slot TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS appointments_date_idx ON appointments(preferred_date);
CREATE TABLE IF NOT EXISTS quotes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reference TEXT NOT NULL UNIQUE,
  phone TEXT NOT NULL,
  vehicle TEXT NOT NULL,
  issue TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS quotes_created_idx ON quotes(created_at);
```
