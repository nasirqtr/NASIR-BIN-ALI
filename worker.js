/**
 * Cloudflare Worker + D1. Bind a D1 database with the variable name DB.
 * Set ALLOWED_ORIGINS as a comma-separated list of exact frontend origins,
 * e.g. https://my-garage.pages.dev,https://garage.example.com
 * Set TURNSTILE_SECRET as a Wrangler secret (never commit it to source).
 *
 * SQL SCHEMA — copy the statements below into schema.sql to initialize D1:
 *
 * CREATE TABLE IF NOT EXISTS appointments (
 *   id INTEGER PRIMARY KEY AUTOINCREMENT,
 *   reference TEXT NOT NULL UNIQUE,
 *   name TEXT NOT NULL,
 *   phone TEXT NOT NULL,
 *   vehicle TEXT NOT NULL,
 *   preferred_date TEXT NOT NULL,
 *   preferred_slot TEXT NOT NULL,
 *   notes TEXT NOT NULL DEFAULT '',
 *   status TEXT NOT NULL DEFAULT 'pending',
 *   created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
 * );
 * CREATE INDEX IF NOT EXISTS appointments_date_idx ON appointments(preferred_date);
 * CREATE TABLE IF NOT EXISTS quotes (
 *   id INTEGER PRIMARY KEY AUTOINCREMENT,
 *   reference TEXT NOT NULL UNIQUE,
 *   phone TEXT NOT NULL,
 *   vehicle TEXT NOT NULL,
 *   issue TEXT NOT NULL,
 *   status TEXT NOT NULL DEFAULT 'pending',
 *   created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
 * );
 * CREATE INDEX IF NOT EXISTS quotes_created_idx ON quotes(created_at);
 */

function json(data, status, origin, origins) {
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Vary": "Origin",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer"
  };
  if (origin && origins.has(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Methods"] = "POST, OPTIONS, GET";
    headers["Access-Control-Allow-Headers"] = "Content-Type";
  }
  return new Response(JSON.stringify(data), { status, headers });
}

function field(value, maxLength = 100) {
  if (typeof value !== "string") return null;
  const cleaned = value.trim();
  return cleaned && cleaned.length <= maxLength ? cleaned : null;
}

function phoneOK(phone) {
  if (!phone || !/^[+()\d\s-]{7,22}$/.test(phone)) return false;
  const digits = phone.replace(/\D/g, "");
  return digits.length >= 7 && digits.length <= 15;
}

function dateOK(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "")) return false;
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) return false;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Qatar", year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  const todayQatar = `${values.year}-${values.month}-${values.day}`;
  return date >= todayQatar;
}

async function checkTurnstile(request, env, token, allowedOrigins) {
  if (!field(token, 2048) || !env.TURNSTILE_SECRET) return false;
  const body = new URLSearchParams({
    secret: env.TURNSTILE_SECRET,
    response: token,
    remoteip: request.headers.get("CF-Connecting-IP") || ""
  });
  try {
    const result = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(8000)
    });
    if (!result.ok) return false;
    const verification = await result.json();
    const allowedHosts = new Set([...allowedOrigins].map((origin) => new URL(origin).hostname));
    return verification.success === true && allowedHosts.has(verification.hostname);
  } catch {
    return false;
  }
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin");
    const origins = new Set((env.ALLOWED_ORIGINS || "").split(",").map((x) => x.trim()).filter(Boolean));
    const path = new URL(request.url).pathname;

    if (request.method === "OPTIONS") {
      if (!origin || !origins.has(origin)) return new Response(null, { status: 403 });
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": origin,
          "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
          "Access-Control-Allow-Headers": "Content-Type",
          "Access-Control-Max-Age": "86400",
          "Vary": "Origin"
        }
      });
    }

    if (path === "/api/health" && request.method === "GET") {
      return json({ ok: true, service: "Nasir Al-Kuwari Garage API" }, 200, origin, origins);
    }
    if (path !== "/api/book" && path !== "/api/quote") {
      return json({ error: "Not found" }, 404, origin, origins);
    }
    if (request.method !== "POST") {
      return json({ error: "Method not allowed" }, 405, origin, origins);
    }
    if (!origin || !origins.has(origin)) {
      return json({ error: "Origin not allowed" }, 403, origin, origins);
    }
    if (!env.DB) return json({ error: "Service unavailable" }, 503, origin, origins);
    if (request.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
      return json({ error: "Expected JSON" }, 415, origin, origins);
    }

    try {
      const bodyText = await request.text();
      if (bodyText.length > 7000) return json({ error: "Request too large" }, 413, origin, origins);
      let input;
      try { input = JSON.parse(bodyText); } catch { return json({ error: "Invalid JSON" }, 400, origin, origins); }
      if (!input || typeof input !== "object" || Array.isArray(input)) {
        return json({ error: "Invalid request" }, 400, origin, origins);
      }

      // Honeypot: ignore bot submissions without storing their data.
      if (input.company_website) return json({ ok: true, reference: "REQUEST-RECEIVED" }, 200, origin, origins);

      const validToken = await checkTurnstile(request, env, input.turnstileToken, origins);
      if (!validToken) return json({ error: "Security verification failed. Please retry." }, 403, origin, origins);

      const phone = field(input.phone, 22);
      const vehicle = field(input.vehicle, 100);
      if (!phoneOK(phone) || !vehicle) {
        return json({ error: "Enter a valid phone number and vehicle." }, 422, origin, origins);
      }
      const reference = `NAK-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;

      if (path === "/api/book") {
        const name = field(input.name, 100);
        const date = field(input.preferredDate, 10);
        const slot = field(input.preferredSlot, 40);
        const notes = input.notes === "" || input.notes == null ? "" : field(input.notes, 800);
        const allowedSlots = new Set(["Morning", "Afternoon", "Flexible"]);
        if (!name || !dateOK(date) || !allowedSlots.has(slot) || notes === null) {
          return json({ error: "Please check your appointment details." }, 422, origin, origins);
        }
        await env.DB.prepare(
          "INSERT INTO appointments (reference,name,phone,vehicle,preferred_date,preferred_slot,notes) VALUES (?,?,?,?,?,?,?)"
        ).bind(reference, name, phone, vehicle, date, slot, notes).run();
      } else {
        const issue = field(input.issue, 1200);
        if (!issue || issue.length < 10) {
          return json({ error: "Please describe the issue in at least 10 characters." }, 422, origin, origins);
        }
        await env.DB.prepare(
          "INSERT INTO quotes (reference,phone,vehicle,issue) VALUES (?,?,?,?)"
        ).bind(reference, phone, vehicle, issue).run();
      }
      return json({ ok: true, reference, message: "Request saved for review" }, 201, origin, origins);
    } catch (error) {
      console.error("Garage request failed", error?.message || "Unknown error");
      return json({ error: "Unable to save your request right now." }, 500, origin, origins);
    }
  }
};
