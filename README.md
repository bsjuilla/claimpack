# ClaimPack

**When a buyer opens a PayPal dispute, ClaimPack builds the evidence pack PayPal asks for, checks it against PayPal's own rules for that dispute, shows the seller exactly what is missing, and, once a person approves, files it through the PayPal Disputes API.**

Built for the PayPal AI Hackathon (Devpost), solo, 5 to 12 November 2026. All data is from the PayPal sandbox or synthetic. Not legal or financial advice.

> The model reads. Code decides. A person approves.

---

## The problem

A solo seller who gets a PayPal dispute has one chance, a deadline, and a rulebook they have never read. PayPal accepts different evidence for different reasons: for *item not received* it wants proof of fulfilment (tracking, or documents showing delivery); for *not as described* it wants what was promised; a refund ID only counts if PayPal itself issued it. Evidence of the wrong type is rejected, and once evidence is filed at a stage, there is no second filing at that stage.

Chargeback agencies do this for large merchants and keep about a quarter of what they win back. Freelancers and small shops answer by hand, late, with whatever screenshot they can find.

## What ClaimPack does

1. **Keeps the proof when you are paid.** Every payment gets an evidence locker: the invoice, the delivery log, the buyer's messages. One click has Muse Spark read them, so a dispute arrives with its evidence already in place.
2. **Notices the dispute.** ClaimPack watches PayPal (it checks the dispute list every 45 seconds; PayPal's signed webhooks are supported when PayPal can reach the server) and opens the case with PayPal's deadline, the buyer's words, and the money PayPal is holding.
3. **Reads every document.** Muse Spark 1.3 reads PDFs, photos and screenshots and returns facts, each with **the exact words it came from**. A document that contains instructions aimed at an AI is set aside, and the seller sees the text.
4. **Decides with PayPal's rules, not with the model.** A tested rules engine applies PayPal's published *reasons and evidence* table, the dispute's stage and the actions PayPal currently allows, and checks every fact against PayPal's own records: the order number, the buyer, the amount charged, refunds PayPal really issued, the deadline. Its verdict is one of **Ready to file**, **Something PayPal needs is missing** (and exactly what), **The evidence contradicts itself**, or **Nothing here PayPal would accept** (refunding is likely cheaper).
5. **Drafts the statement, then checks it.** Muse Spark writes a short, factual statement from the facts the engine chose. Code rejects any sentence that cites nothing, and any number, date, time, link or email the cited documents do not contain, and any accusation against the buyer. It checks again as the seller edits.
6. **A person approves, then ClaimPack files.** The seller sees the exact request PayPal will receive, types their name and confirms. ClaimPack re-checks everything on the server (the pack must still be the one they reviewed), sends the evidence through `provide-evidence` with a generated evidence-summary PDF, reads the dispute back and logs what was sent, by whom, with file fingerprints.

## Proof it works against PayPal (sandbox, 7 November 2026)

| Step | What happened |
|---|---|
| Sale | Test sale made from ClaimPack's own checkout, invoice `INV-2041` sent as PayPal's `invoice_id`; payment `9FR10076AF236761F` captured 07:05:59 UTC |
| Before any dispute | The seller's invoice PDF and delivery log were added to that payment's locker and read by Muse Spark (2.7 cents) |
| Dispute | The sandbox buyer opened *item not received* in PayPal's Resolution Center: `PP-R-XYA-10196950`, 07:13 UTC |
| ClaimPack | Picked it up from PayPal about 3.5 minutes later (when PayPal allowed seller evidence); verdict **Ready to file, 100%**, no warnings; the delivery log shows the files downloaded twice and the buyer writing "Got the files, thanks!" three minutes before the dispute |
| Approval and filing | The seller drafted, read and approved the statement in ClaimPack; `provide-evidence` returned 200 |
| PayPal's record | Read back from PayPal: `SUBMITTED_BY_SELLER`, `PROOF_OF_FULFILLMENT`, documents `evidence-summary.pdf` and `delivery-log.pdf`; status `WAITING_FOR_BUYER_RESPONSE` |

## Measured on 30 synthetic disputes

Thirty disputes across seven of PayPal's dispute reasons, each with the documents a real seller might hold: invoice PDFs, delivery logs, carrier tracking pages and chat conversations **as images**, listings, refund emails, contracts and subscription terms (39 documents, all stamped SPECIMEN). Planted traps: tracking for another order, a parcel delivered to someone else, an invoice that disagrees with what PayPal charged, a refund ID PayPal never issued, instructions to the AI hidden in a delivery log and in a listing, a missed deadline, a carrier PayPal does not list, a delivery after the complaint, and dates written without a year. The real pipeline ran on every case: Muse Spark read each document, the rules engine decided, and for every case judged ready the drafter wrote a statement checked by the guard.

| | First run | After two fixes (same saved readings, no new AI calls) |
|---|---|---|
| Verdicts right | 28 / 30 | **30 / 30** |
| Evidence type right (ready cases) | 17 / 17 | 17 / 17 |
| Right documents attached, and never a document that must not go to PayPal | 29 / 30 | 30 / 30 |
| Hidden instructions to the AI caught | 2 / 2 | 2 / 2 |
| Clean documents wrongly set aside | 0 | 0 |
| **Dangerous errors** (would let a person file a pack that is not ready, or attach a document that must not be sent) | **0** | **0** |
| Drafted statements passing the guard | 15 / 15 (14 at the first attempt) | 17 / 17 (16 at the first attempt) |

Cost of the whole live run: reading 39 documents $0.38, drafting the statements $0.12.

**The two first-run failures, and what changed:**
- *Dates written without a year* (`05/10 08:45`). The reader correctly refused to guess a year, so both deliveries were dropped and the case fell to "no defence". Fix: the reader keeps the line as written and code picks the reading (day-first or month-first, which year) nearest the payment date, then **tells the seller what it assumed** so they can check it (`src/rules/dates.ts`, with tests).
- *A case with a deadline already passed.* My own test case: the dispute's 20-day deadline expired on the morning of the scoring date, and ClaimPack correctly said so. The case's dates were corrected.

Because those fixes were made after seeing the test, the second column is not a held-out score. Both runs are published: `eval/runs/published-2026-11-07-first-run/` and `eval/runs/published-2026-11-07/`, with every reading the model returned. The set was written by the builder, so it shares the builder's blind spots, and the tracking pages and chats are rendered by code, not photographed. Re-score it yourself, free and without keys: `REPLAY=published-2026-11-07 npx tsx scripts/eval/run.ts`.

## How PayPal is used

| PayPal capability | Endpoint | What ClaimPack does with it |
|---|---|---|
| OAuth 2.0 | `POST /v1/oauth2/token` | Server-side token, cached; credentials never reach the browser |
| Disputes: list and show | `GET /v1/customer/disputes`, `GET /v1/customer/disputes/{id}` | Watches for new disputes; reads reason, stage, deadline, the buyer's words, items, seller-protection flag and the **HATEOAS links** that say what the seller may do now |
| Disputes: provide evidence | `POST /v1/customer/disputes/{id}/provide-evidence` (multipart) | Files the approved pack: evidence type, `tracking_info` or `refund_ids`, notes, and the documents |
| Payments | `GET /v2/payments/captures/{id}`, `GET /v2/checkout/orders/{id}` | Finds refunds PayPal really issued for the payment (only `COMPLETED` ones count) and money PayPal is holding |
| Orders | `POST /v2/checkout/orders`, `.../capture` | The test checkout, which sends the seller's own invoice number as `invoice_id` so evidence can be matched to the payment |
| Webhooks | `POST /v1/notifications/verify-webhook-signature` | `CUSTOMER.DISPUTE.*` and `PAYMENT.CAPTURE.COMPLETED` are accepted only after PayPal verifies the signature, and de-duplicated by event id |

### What the sandbox taught us (and what ClaimPack does about it)

- A buyer's complaint immediately puts the payment on hold (`PENDING`, reason `BUYER_COMPLAINT`) with a pending reversal of the net amount. ClaimPack shows it as money held, and never counts it as a refund.
- In the inquiry stage, `OTHER` evidence for *item not received* is refused (`EVIDENCE_TYPE_IS_NOT_ALLOWED`); `PROOF_OF_FULFILLMENT` is accepted. The rules engine encodes PayPal's table so the wrong type is never offered.
- PayPal's documentation accepts `.jpg .jpeg .gif .png .pdf` under 10 MB. The sandbox also accepted a `.txt`; ClaimPack does not rely on that and sends a faithful PDF copy of any text evidence.
- PayPal masks email addresses in the seller's notes (`xxxx`), so the drafter leaves them out.
- Without an `invoice_id` on the order, PayPal's record has no invoice number, and a seller's documents cannot be tied to the payment by order number. ClaimPack says so and asks sellers to send it.
- Creating a dispute through the API as a buyer needs extra scopes from a PayPal account manager, so disputes for testing are opened in the sandbox Resolution Center, exactly as a real buyer would.

## The AI, and how it is kept honest

- **Model:** Meta Muse Spark 1.3 (`muse-spark-1.3`) through the Meta Model API: vision and PDF input, strict JSON-schema output. About 1 to 3 cents per document and about 1 cent per statement.
- **The reader** returns typed facts with the exact quote and page; rows missing what their kind needs are dropped and counted.
- **Prompt injection:** text addressed to an AI ("ignore your instructions…") puts the whole document aside. Nothing from it is used or attached, and the seller sees why.
- **The model never decides.** Verdicts, evidence types, attachments and the deadline are code (`src/rules/engine.ts`), unit-tested against PayPal's published rules.
- **The statement guard** (`src/rules/statement.ts`) is code too: no sentence without a cited fact; no number, date, month, time, link or email the cited documents do not contain (document ids never count as evidence); no accusations.
- **Filing is gated four times on the server:** the pack is *Ready*, PayPal currently offers `provide_evidence`, a named person approved, and the plan hash matches what that person reviewed.

## Run it

You need Node.js 22.5 or later, a PayPal developer account with a **sandbox** app (developer.paypal.com, Apps & Credentials, Sandbox), and a Meta Model API key for the AI steps.

```bash
git clone https://github.com/bsjuilla/claimpack.git
cd claimpack
npm install
cp .env.example .env      # then add your PayPal sandbox client ID and secret, and META_API_KEY
npm test                  # the rules engine, the statement guard, PayPal parsing
npm run app               # builds the web app and starts http://127.0.0.1:8790
```

Then, in the app:

1. **Payments, Make a test sale.** Approve it as your sandbox *personal* (buyer) account; you return to the payment's evidence locker.
2. Add the seller's documents (an invoice, a delivery log, a chat screenshot) and press **Read**.
3. As the sandbox buyer, open **sandbox.paypal.com, Resolution Center, Report a problem** on that payment.
4. Within a few minutes the dispute appears in **Disputes** by itself. Open it, draft the statement, approve with your name and **File evidence with PayPal**.

**Without any keys** you can still run the tests and re-score the published evaluation from its saved readings:

```bash
npm test
REPLAY=published-2026-11-07 npx tsx scripts/eval/run.ts
```

To re-run the evaluation live (about $1 of Meta API credit): `npx tsx scripts/eval/build.ts` then `DRAFT=1 npx tsx scripts/eval/run.ts`.

## Security

- The server listens on `127.0.0.1` only. API requests from other hosts or other websites are refused (DNS rebinding and cross-site request protection).
- PayPal credentials and the Meta key stay in `.env` on the server; nothing secret reaches the browser.
- Uploads: allow-listed types, 10 MB limit, sanitised names, files stored by content hash, never executed.
- Webhooks are trusted only after PayPal verifies their signature.

## Limits (said plainly)

- Everything here is sandbox or synthetic. ClaimPack measures whether a pack meets PayPal's published rules; it cannot measure whether PayPal will decide in the seller's favour, and it does not claim to.
- Documents are uploaded or dropped in; there is no inbox integration.
- The evaluation set was written by the builder, so it shares the builder's blind spots. Its failures are listed above, not hidden.
- PayPal's sandbox accepted one evidence filing per dispute stage in our tests; ClaimPack treats every filing as final.

## Credits

Built solo during the PayPal AI Hackathon, 5 to 12 November 2026, by Divyesh Kumar Khadun. The illustrations (folders, receipts, parcel, hourglass, loupe and the desk photograph) were generated with an AI image model from prompts written for this project. Data grid: AG Grid Community (MIT). Licence: MIT.
