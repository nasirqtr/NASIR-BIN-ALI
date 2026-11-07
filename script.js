"use strict";

// Read PUBLIC values from site-config.js (see SETUP-FORMS.md).
const GARAGE_CONFIG = window.GARAGE_CONFIG || {};
const API_ORIGIN = String(GARAGE_CONFIG.apiOrigin || "").trim().replace(/\/+$/, "");
const TURNSTILE_SITEKEY = String(GARAGE_CONFIG.turnstileSiteKey || "").trim();
const PHONE_DISPLAY = "+974 5524 1833";

const header = document.querySelector(".site-header");
const menuToggle = document.getElementById("menuToggle");
const primaryNav = document.getElementById("primaryNav");
const bookingForm = document.getElementById("bookingForm");
const quoteForm = document.getElementById("quoteForm");

document.getElementById("year").textContent = new Date().getFullYear();
const showHeaderShadow = () => header.classList.toggle("scrolled", window.scrollY > 10);
window.addEventListener("scroll", showHeaderShadow, { passive: true });
showHeaderShadow();

function closeMenu() {
  primaryNav.classList.remove("open");
  menuToggle.setAttribute("aria-expanded", "false");
  menuToggle.setAttribute("aria-label", "Open navigation");
}
menuToggle.addEventListener("click", () => {
  const open = !primaryNav.classList.contains("open");
  primaryNav.classList.toggle("open", open);
  menuToggle.setAttribute("aria-expanded", String(open));
  menuToggle.setAttribute("aria-label", open ? "Close navigation" : "Open navigation");
});
primaryNav.querySelectorAll("a").forEach(a => a.addEventListener("click", closeMenu));
document.addEventListener("keydown", e => { if (e.key === "Escape") closeMenu(); });
document.addEventListener("click", e => {
  if (!header.contains(e.target)) closeMenu();
});

// Match Qatar's actual calendar date, rather than the viewer's computer time zone.
function todayInQatar() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Qatar", year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}
const preferredDate = document.getElementById("preferredDate");
preferredDate.min = todayInQatar();
// Garage is closed every Friday in Doha. Dates are ISO strings, so UTC weekday
// is stable and does not depend on the visitor's device time zone.
function isFriday(dateString) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateString || "")) return false;
  const date = new Date(`${dateString}T12:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.getUTCDay() === 5;
}
function checkAppointmentDay() {
  preferredDate.setCustomValidity(isFriday(preferredDate.value)
    ? "The garage is closed on Friday. Please choose Saturday to Thursday."
    : "");
}
preferredDate.addEventListener("change", checkAppointmentDay);
preferredDate.addEventListener("input", checkAppointmentDay);

// Pick a service card to prefill the quote request, or pick a car make to prefill booking.
document.querySelectorAll("[data-service]").forEach(link => {
  link.addEventListener("click", () => {
    const service = link.dataset.service;
    document.getElementById("quoteService").value = service;
    document.querySelector('#quoteForm [name="issue"]').placeholder = `Tell us about your ${service.toLowerCase()} enquiry, vehicle symptoms or repair requirements...`;
  });
});
document.querySelectorAll("[data-make]").forEach(button => {
  button.addEventListener("click", () => {
    const input = document.getElementById("bookingVehicle");
    input.value = button.dataset.make === "Other" ? "" : button.dataset.make + " ";
    window.location.hash = "booking";
    input.focus({ preventScroll: true });
  });
});

// Lightweight scroll transitions that honor the user's reduced-motion setting.
if ("IntersectionObserver" in window && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
  const cards = document.querySelectorAll("[data-reveal]");
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        entry.target.classList.remove("pre-reveal");
        entry.target.classList.add("revealed");
        observer.unobserve(entry.target);
      }
    }
  }, { threshold: .07, rootMargin: "0px 0px -20px 0px" });
  cards.forEach(card => { card.classList.add("pre-reveal"); observer.observe(card); });
}

function setStatus(form, message, type = "") {
  const target = form.querySelector(".form-status");
  target.className = `form-status ${type}`;
  target.textContent = message;
}
function isConfigured() {
  try {
    const url = new URL(API_ORIGIN);
    return url.protocol === "https:" && !!url.hostname && !url.hostname.includes("replace");
  } catch {
    return false;
  }
}

// Turnstile is only loaded once the PUBLIC key and Worker endpoint are both configured.
// No invalid "REPLACE_WITH_..." widget is shown to visitors.
const turnstileWidgetIds = new WeakMap();
function setupSecurityWidgets() {
  const forms = [bookingForm, quoteForm];
  if (!isConfigured() || !TURNSTILE_SITEKEY || TURNSTILE_SITEKEY.includes("REPLACE")) {
    for (const form of forms) {
      const help = form.querySelector("[data-security-helper]");
      help.textContent = "Online submissions are not available yet. Please call the garage to book or request a quote.";
      help.classList.add("not-ready");
    }
    return;
  }
  const script = document.createElement("script");
  script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
  script.async = true;
  script.defer = true;
  script.onload = () => {
    if (!window.turnstile) return;
    for (const form of forms) {
      const slot = form.querySelector("[data-turnstile-slot]");
      const help = form.querySelector("[data-security-helper]");
      try {
        const widgetId = window.turnstile.render(slot, {
          sitekey: TURNSTILE_SITEKEY,
          theme: "light",
          size: "flexible",
          callback(token) { form.dataset.turnstileToken = token; help.textContent = ""; },
          "expired-callback"() { form.dataset.turnstileToken = ""; help.textContent = "Security check expired. Please verify again."; },
          "error-callback"() { form.dataset.turnstileToken = ""; help.textContent = "Security check could not load. Please try again or call the garage."; }
        });
        turnstileWidgetIds.set(form, widgetId);
      } catch {
        help.textContent = "Security check could not load. Please call the garage.";
      }
    }
  };
  script.onerror = () => {
    for (const form of forms) {
      form.querySelector("[data-security-helper]").textContent = "Security check is unavailable. Please try again later or call the garage.";
    }
  };
  document.head.appendChild(script);
}
setupSecurityWidgets();
async function submitForm(form, route, payload) {
  if (!form.reportValidity()) return;
  const phone = form.elements.phone.value.trim();
  if (phone.replace(/\D/g, "").length < 7 || phone.replace(/\D/g, "").length > 15) {
    setStatus(form, "Please enter a valid phone number, including the country code where applicable.", "error");
    form.elements.phone.focus();
    return;
  }
  if (!isConfigured()) {
    setStatus(form, `Online requests are not active yet. Please call ${PHONE_DISPLAY} to arrange a booking or estimate.`, "notice");
    return;
  }
  const token = form.dataset.turnstileToken || "";
  if (!token) {
    setStatus(form, "Please complete the security verification. If it is not visible, call the garage for assistance.", "error");
    return;
  }
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  setStatus(form, "Sending your request...");
  try {
    const response = await fetch(API_ORIGIN + route, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, turnstileToken: token, company_website: form.elements.company_website.value })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Your request could not be saved. Please call the garage.");
    form.reset();
    setStatus(form, `Request saved! Reference: ${data.reference}. The garage will need to confirm your appointment or estimate.`, "success");
  } catch (error) {
    setStatus(form,
      error instanceof TypeError ? `Unable to connect. Please call ${PHONE_DISPLAY} or try again.` : error.message,
      "error"
    );
  } finally {
    button.disabled = false;
    button.removeAttribute("aria-busy");
    // Tokens are one-time-use; reset for both successful and failed requests.
    form.dataset.turnstileToken = "";
    if (window.turnstile && turnstileWidgetIds.has(form)) {
      try { window.turnstile.reset(turnstileWidgetIds.get(form)); } catch (_) { /* Widget may have unloaded */ }
    }
  }
}
bookingForm.addEventListener("submit", event => {
  event.preventDefault();
  checkAppointmentDay();
  const form = event.currentTarget;
  const service = form.elements.service.value.trim();
  const additionalNotes = form.elements.notes.value.trim();
  // Existing appointments schema stores service choice in notes, keeping original D1 tables compatible.
  submitForm(form, "/api/book", {
    name: form.elements.name.value.trim(),
    phone: form.elements.phone.value.trim(),
    vehicle: form.elements.vehicle.value.trim(),
    preferredDate: form.elements.preferredDate.value,
    preferredSlot: form.elements.preferredSlot.value,
    notes: `[Service: ${service}]${additionalNotes ? "\n" + additionalNotes : ""}`
  });
});
quoteForm.addEventListener("submit", event => {
  event.preventDefault();
  const form = event.currentTarget;
  // Existing quotes schema stores service choice together with the customer description.
  submitForm(form, "/api/quote", {
    phone: form.elements.phone.value.trim(),
    vehicle: form.elements.vehicle.value.trim(),
    issue: `[Service: ${form.elements.service.value.trim()}]\n${form.elements.issue.value.trim()}`
  });
});
