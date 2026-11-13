# External User RBAC — Tester Guide

_A plain-English guide for testers and non-developers. No coding knowledge required to follow the steps, but a developer needs to have the backend running on your machine or a test environment first._

> This guide covers **External User RBAC** — an applicant coming back to view/edit a registration they already submitted. For the underlying magic-link **email verification** mechanism itself (used when completing a brand-new submission), see `magic-link-tester-guide.md`. The two are related — RBAC is built on top of email verification — but have separate tester guides, Postman collections and specs, since they're separate pieces of work with separate sign-off.

---

## 1. What is this feature?

Normally, people who use the Pesticides OCR system sign in with their **work Microsoft account (Azure AD)** — that's how staff access the system.

But **external applicants** (people outside the organisation who've submitted a pesticide product registration) don't have a work account. They still need a way to:

- View their own registration/application
- Make edits to their own registration

The **External User RBAC ("magic link")** feature gives them a secure way to do this **without a username or password**, using only their **email address**.

### In short:
1. The applicant enters their email address on a page.
2. We email them a **special one-time link** (the "magic link").
3. They click the link, which logs them in automatically.
4. They can now view and edit **only their own** registration — nothing else, and nobody else's.
5. The link/session expires after a short time, for security.

No Azure AD, no passwords — just "prove you own this email address" security.

---

## 1a. Internal (staff) users vs external (applicant) users — side by side

This is the heart of what this ticket changes, so it's worth being explicit about the difference:

| | **Internal users** (HSE/DEFRA staff, e.g. case officers) | **External users** (applicants, via magic link) |
|---|---|---|
| How they prove who they are | Sign in with their **work Microsoft account** (Azure AD / Entra) | Prove they own an **email address** by clicking a one-time link |
| What "logging in" gets them | A Microsoft-issued token, checked against the organisation's staff directory | A token this system itself issues, after checking the email matches a registration |
| What they can see/do | Search, view and edit **any** registration (an internal "case officer" role) | View/edit **only the one registration** whose contact email they just proved they own |
| Technical mechanism | The `entra-bearer` authentication strategy | A completely separate `external-bearer` authentication strategy |
| Can one type's credential be used as the other? | **No** — these are two independent mechanisms. A magic-link token is cryptographically impossible to use on a staff-only page, and vice versa, even if you tried | — |
| How long access lasts | Governed by the organisation's normal Microsoft sign-in session rules | 30 minutes, then they must click a fresh magic link to continue |
| What happens if the applicant's own registration's contact email changes | N/A — doesn't affect staff at all | Their current access is **immediately cancelled** — they must verify the new email address again before they (or anyone) can get back in |

**Why two separate mechanisms, not one shared login?** Staff need broad access across many registrations and already have an organisational identity (their work account) to prove who they are. Applicants have neither — they're not "in the system" in that sense, only an email address is known about them, and that's deliberately as far as the trust goes: it proves inbox ownership of one address, and that's used only to unlock the one record that address is already associated with. Keeping the two completely separate (rather than one login screen that branches) means a bug or bypass in one can never accidentally grant access through the other.

---

## 2. How it works (behind the scenes, simplified)

| Step | What happens | Analogy |
|---|---|---|
| 1. Request | Applicant types their email into a form | "I'd like to log in" |
| 2. We create a one-time code | The system generates a random, secret code and stores a *record* of it in the database (marked "pending") | A one-time password written on a sealed envelope |
| 3. Email sent | We email the applicant a link containing that code (via GOV.UK Notify) | We post them the envelope |
| 4. Applicant clicks link | The system checks the code matches what's stored, hasn't expired, and hasn't been used already | Door bouncer checks the envelope is genuine and not already used |
| 5. Exchange for access | If valid, the system issues the applicant a temporary secure "pass" (a token) tied to their specific registration | Wristband for the night — only works for this applicant, only for a little while |
| 6. View/Edit | The applicant uses that pass to view or update **their own registration only** | Wristband only opens their own hotel room door |
| 7. Expiry | After a set time (or if unused), the one-time code and the pass both stop working | Wristband stops working after the event |

**Key security rules (already tested and confirmed working):**
- A one-time code can only be used **once**.
- **Proving you own an email address is not, by itself, enough to access a registration.** The email on the magic link request must also match that specific registration's own contact email — the system checks this before handing out any access, every time (not just the first time).
- A pass only works for **the applicant's own registration** — trying to view someone else's is blocked, and the error message is identical whether the registration doesn't exist or just isn't theirs (so nobody can use the error to go "fishing" for valid references).
- A pass **cannot** be used to access staff-only ("internal") parts of the system.
- Everything expires automatically after a short window.
- **If an applicant changes the contact email on their registration, their own current pass stops working immediately** — the new email address has to prove ownership again before anyone (including that same applicant) can get back in.

---

## 3. What database "collections" (tables) are involved?

Think of the database as a filing cabinet with different drawers ("collections"). This feature touches three drawers:

| Collection name | What it stores | What you'd see change during a test |
|---|---|---|
| `ocr-email-verifications` | Temporary one-time codes — one entry per "log me in" request. Each has a status: `pending` → `verified` (or `expired`/`superseded`). | A new entry appears when the applicant requests a link; it flips from `pending` to `verified` once they click it. |
| `ocr-registration-access` | Which verified applicant is currently allowed into which registration — the "pass list". One entry per applicant/registration pair, with an expiry and (if applicable) a revoked time. | A new entry appears the first time an applicant verifies for a reference; it gets a fresh expiry each time they re-verify, and is marked revoked if the registration's contact email is changed. |
| `ocr-registration` | The applicant's actual registration/application data | Unchanged unless the applicant edits something after logging in — then you'd see their edit reflected here. |

You don't need to understand the technical field names — just know:
- **`ocr-email-verifications`** = short-lived "login codes", cleans itself up automatically.
- **`ocr-registration-access`** = the "pass list" — who currently has a valid pass to which registration, and until when.
- **`ocr-registration`** = the real data the applicant is allowed to view/edit.

---

## 4. How to test it

There are **three ways** to test, depending on whether you want a real email sent:

### Option A — Quick test, no real email (recommended for most testing)
This "fakes" the email step so you don't need a real inbox. A developer runs one command and it walks through the entire journey automatically, printing out each step and whether it passed.

**Steps for the developer to run (you can watch the output):**
1. Make sure the backend is running locally (`npm run dev`).
2. In a second terminal, run:
   ```
   npm run test:external-user-flow
   ```
3. Watch the output — it will:
   - Create a test applicant's registration, and a second, unrelated one
   - Simulate requesting and clicking a magic link for the test applicant's own email
   - Confirm that verifying for the **own** registration succeeds and hands out a pass
   - Try (and correctly fail) to use the **same verified email** to get a pass for the **other, unrelated** registration — proving that owning an inbox alone isn't enough; it must be the registration's own contact email
   - Log in as the applicant, view and edit their own registration
   - Try (and fail, correctly) to view someone else's registration with a valid pass for the wrong reference
   - Try (and fail, correctly) to access a staff-only route
   - Change the registration's contact email, then confirm the applicant's own existing pass immediately stops working
   - Print a summary of ✅ pass / ❌ fail for each check

If every line ends in ✅, the feature works correctly.

### Option B — Full real-email test (closer to real life)
This sends an actual email via GOV.UK Notify to a real inbox, and you manually click the link.

**Requirements:** the email address must be on the Notify "guestlist" (ask a developer to check/add it) — this is a safety feature so test emails don't go to random addresses.

**Steps:**
1. Developer runs:
   ```
   npm run test:external-user-flow -- --mode=notify --email=your.email@example.com
   ```
2. Check your inbox for an email with a "verify" link.
3. Click the link (or the script will ask you to paste the code from the link).
4. The script continues automatically and shows the same ✅/❌ checklist as Option A.

### Option C — Manual click-through (for non-technical sign-off / demo)
If you'd prefer to see the actual applicant experience in a browser rather than terminal output, ask a developer to:
1. Run the Notify-mode test above to get a real email, **or**
2. Give you a magic-link URL directly in a test environment.

Then you simply:
1. Open the emailed link in your browser.
2. Confirm you land on a page showing **your own registration only**.
3. Try editing a field and saving — confirm it's saved.
4. Confirm that if you wait past the expiry time (or try the same link twice), it correctly shows an error/expired message.
5. Ask a developer to change the registration's contact email on your behalf (or do it yourself if the edit page allows it), then try to view the registration again — confirm you're asked to verify again rather than being let straight back in.

### Option D — Postman (API-level, for developers/QA)

See `external-user-rbac.postman_collection.json` — set up as described in its own description (`baseUrl`, `journeyTokenSecret`, `email`), then run through its 5 folders in order: set up test registrations, verify with reference (success/entitlement-denied/not-found/no-reference), view and edit, cross-record and cross-population denial, and contact-email-change revocation.

---

## 5. What a successful test looks like

✅ Applicant receives an email with a link
✅ Clicking the link logs them in (no password needed)
✅ Applicant sees their own registration details
✅ Applicant can edit and save their own registration
✅ Applicant **cannot** see or edit another applicant's registration, even when they are genuinely the owner of the verified email address used — it must also be *that registration's own* contact email
✅ The error shown for "wrong registration" and "registration doesn't exist" look identical — nothing about the message gives away which one it is
✅ Applicant **cannot** access staff/internal-only pages
✅ The link only works once
✅ The link stops working after it expires
✅ Changing the registration's contact email immediately revokes the applicant's own current access — they must verify the new address again

If any of the above fails, that's a bug to report — please note exactly which step failed and the error message shown.

---

## 6. Who to ask if something's unclear

Contact the development team with:
- Which test option you used (A, B, C or D)
- The email address used (if Option B/C)
- A screenshot or copy of any error message
- Roughly what time you ran the test (helps find logs)

---

## 7. Decisions behind the design (confirmed)

A few behaviours were initially implemented with a stated default while awaiting sign-off, and have since been **confirmed** (2026-11-11) — see `magic-link-tickets.md` → "Complete secure applicant access to registrations: decisions confirmed", or the full rationale in `external-user-rbac-spec.html` §6, for the full detail behind each:

- A "wrong registration" access attempt returns a generic `403`, identical whether the registration doesn't exist or just isn't yours.
- Changing the contact email revokes *every* applicant's access immediately, rather than letting the current session keep working until it naturally expires.
- Only the registration's own primary contact — not, for example, an additional address's contact — is ever entitled to access it.

---

## 8. Related documents

- `external-user-rbac-spec.html` — the full technical specification
- `external-user-rbac.postman_collection.json` — API-level request/response checks
- `magic-link-api-design.md` §9 — how this fits into the wider email-verification design
- `magic-link-tickets.md` — ticket breakdown and confirmed decisions
- `magic-link-tester-guide.md` — the tester guide for the underlying email-verification mechanism this feature is built on top of
