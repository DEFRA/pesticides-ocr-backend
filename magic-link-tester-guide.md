# Email Verification ("Magic Link") — Tester Guide

_A plain-English guide for testers and non-developers. No coding knowledge required to follow the steps, but a developer needs to have the backend (and usually the frontend) running first._

> This guide covers **email verification** — confirming an applicant owns their email address while completing a brand-new registration. For an applicant coming back **later** to view/edit a registration they already submitted, see `external-user-rbac-tester-guide.md` instead — that's a separate, additive feature built on top of this one.

---

## 1. What is this feature?

Partway through submitting a pesticide product registration, the applicant is asked for a contact email address. Before the submission can be completed, the system needs to be sure the applicant really owns that address — otherwise anyone could submit a registration using someone else's email, and that person would start getting correspondence about a registration they know nothing about.

Rather than a username/password account, the system proves ownership with a **single-use, time-limited email link** — a "magic link" — sent via GOV.UK Notify.

### In short:
1. The applicant enters their email address on a page, partway through the journey.
2. We immediately email them a **one-time link**.
3. They open the link and press "Confirm".
4. Their journey session now knows that email address is verified, and they can continue to submit.
5. If they don't click it in time, or use it twice, they're told clearly what to do next.

No account is created. No password is ever asked for. This only proves "this email address, right now, for this one submission attempt" — it doesn't give the applicant any lasting access to anything (that's what External User RBAC, a separate feature, is for).

---

## 2. How it works (behind the scenes, simplified)

| Step | What happens | Analogy |
|---|---|---|
| 1. Request | Applicant types their email into a form | "Please send me a confirmation link" |
| 2. We create a one-time code | The system generates a random, secret code and stores a *record* of it in the database (marked "pending") | A one-time password written on a sealed envelope |
| 3. Email sent | We email the applicant a link containing that code (via GOV.UK Notify) | We post them the envelope |
| 4. Applicant opens the link | The page shows a "Confirm" button — opening the link alone doesn't use up the code (see below) | Receiving the envelope doesn't open it |
| 5. Applicant presses Confirm | The system checks the code matches what's stored, hasn't expired, and hasn't been used already | Door bouncer checks the envelope is genuine and not already used |
| 6. Continue the journey | Once confirmed, the applicant can carry on and submit, using that same email address | Ticket stamped, you're in |
| 7. Expiry | After a set time (or if a newer link was requested instead), the code stops working | The envelope's one-time password expires |

**Why does opening the link not immediately use it up?** Email providers and security scanners (e.g. Outlook's "Safe Links") often open links automatically to check they're safe, *before* a human ever sees the email. If opening the link alone confirmed the address, the applicant's own click would then fail — "already used" — even though they never clicked it themselves. That's why there's a separate "Confirm" button: only pressing that consumes the one-time code.

**Key security rules (already tested and confirmed working):**
- A link can only be used **once**.
- Each new link **replaces** the previous one — only the newest link for a journey still works.
- A link that's expired, already used, or replaced by a newer one each get their own distinct message (never a vague "something went wrong").
- Opening the link on a different device or browser than the one the applicant started on still works — they're told to go back to the original browser to continue.
- There are limits on how many links can be requested (per address and per journey) within an hour, and a short cooldown between resends, so the feature can't be used to spam an inbox.
- Nothing about the token, link or email address ever appears in logs or audit trails (only a one-way hash of the address, for traceability without exposing it).

---

## 3. What database "collections" (tables) are involved?

Think of the database as a filing cabinet with different drawers ("collections"). This feature touches one drawer:

| Collection name | What it stores | What you'd see change during a test |
|---|---|---|
| `ocr-email-verifications` | Temporary one-time codes — one entry per "send me a link" request. Each has a status: `pending` → `verified` (or `expired`/`superseded`). | A new entry appears when the applicant requests a link; it flips from `pending` to `verified` once they press Confirm. Old entries clean themselves up automatically after a short retention period. |

The applicant's actual registration data isn't touched at all until the final submission — this feature only ever reads and writes the email-verification record.

---

## 4. How to test it

### Option A — Through the frontend journey (closest to real life)
1. Start the OCR registration journey on the frontend, and get to the email address page.
2. Enter an email address on the Notify "guestlist" (ask a developer to check/add it, or the email won't actually arrive).
3. You'll be taken to a "Check your email" waiting page.
4. Check your inbox, open the email, and press **Confirm** on the page it opens.
5. You should see a success message, and be able to continue (and finish) the journey.

Also worth trying, each with its own distinct message:
- **Resend**: wait a moment, press "resend", then try opening the **original, first** email's link — it should say it's been replaced.
- **Reuse**: use a link successfully, then open and confirm the *same* email again — it should say it's already been used.
- **Wait it out**: ask a developer to lower the expiry time on a test environment, wait past it, then try confirming — it should say it's expired, with a way to request a new one.
- **Cross-device**: request the link on a laptop, open and confirm it on your phone instead, then go back to the laptop — the laptop should pick up that the address is now verified.

### Option B — API-level, with Postman (for developers/QA)
See `email-verification-magic-link.postman_collection.json` (or `email-verification-magic-link.dev.postman_collection.json` for the CDP dev environment) for request/resend/verify/status checks without needing the frontend at all.

### Option C — Full scripted test scenarios (for the team tester / sign-off)
See `magic-link-test-scenarios.md` for a complete numbered list of scenarios (happy path, cross-device, expired, reused, resend, rate-limited, Notify failure, accessibility, cross-browser and performance checks), intended for a dedicated test pass and sign-off recording.

---

## 5. What a successful test looks like

✅ Applicant receives an email promptly after requesting it
✅ Pressing Confirm on the link's page verifies the address and lets the journey continue
✅ Opening the link (without pressing Confirm) does **not** use it up
✅ A reused link is clearly rejected, without breaking the journey
✅ A resent link replaces the old one; only the newest works
✅ An expired link is clearly rejected, with a way to request a new one
✅ Verifying on a different device/browser is handled gracefully, with clear instructions
✅ Requesting too many emails in a short time is blocked with a clear message
✅ Nothing in the page URL, API responses or logs ever shows the token or the full email address

If any of the above fails, that's a bug to report — please note exactly which step failed and the error message shown.

---

## 6. Who to ask if something's unclear

Contact the development team with:
- Which option you used (A, B or C)
- The email address used
- A screenshot or copy of any error message
- Roughly what time you ran the test (helps find logs)

---

## 7. Related documents

- `magic-link-api-design.md` — the full technical design
- `magic-link-tickets.md` — ticket breakdown (MLV-0 to MLV-9)
- `magic-link-test-scenarios.md` — the full numbered test scenario list, for formal sign-off
- `email-verification-magic-link.postman_collection.json` — API-level request/response checks
- `external-user-rbac-tester-guide.md` — the related, separate feature letting an applicant come back later to view/edit a registration they already submitted
