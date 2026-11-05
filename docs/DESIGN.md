# ClaimPack — design (v1, 5 Nov 2026)

**One line:** when a buyer opens a PayPal dispute, ClaimPack builds the evidence pack the seller needs, checks it against PayPal's own rules for that dispute reason and stage, shows the seller exactly what is missing, and, once a person approves, files it through the PayPal Disputes API.

**Principle (carried over from Substance Proof):** *the model reads, code decides, a person approves.* The AI reads documents and drafts wording. It never decides whether a pack can be filed, which evidence type to use, or whether to file. Tested code does that from PayPal's published rules, and nothing is sent to PayPal without a human click.

**Who it is for:** solo sellers, freelancers and small online shops on PayPal who lose disputes because they answer late, send the wrong evidence type, or send nothing. They will not pay a chargeback agency 25% of what it wins back.

---

## 1. What PayPal allows (the rules the code enforces)

All of this is from PayPal's developer docs, read 5 Nov 2026. Sources are in `docs/sources/`.

- **Stages:** `INQUIRY` (20 days, buyer and seller talk) → claim stage `CHARGEBACK` (PayPal decides) → `PRE_ARBITRATION` / `ARBITRATION` (seller appeals).
- **Which actions are allowed** comes from the dispute's HATEOAS `links`, not from our own guesses. The code reads `links[].rel` (e.g. `provide_evidence`, `accept_claim`, `make_offer`, `send_message`, `escalate`, `acknowledge_return_item`).
- **Evidence types by reason** ("Dispute reasons and evidence"):

| Reason | Allowed evidence types | What each needs |
|---|---|---|
| `MERCHANDISE_OR_SERVICE_NOT_RECEIVED` | `PROOF_OF_FULFILLMENT`, `PROOF_OF_REFUND` | Fulfilment: carrier + tracking number, **or** notes/documents (proof of delivery, receipt). Refund: refund IDs. |
| `MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED` | `OTHER`, `PROOF_OF_REFUND` | Other: notes/docs (description, item URL, return policy, contract, affidavit). |
| `UNAUTHORISED` | `PROOF_OF_FULFILLMENT`, `PROOF_OF_REFUND`, `OTHER` | Fulfilment: carrier + tracking. Other: notes/docs. |
| `CREDIT_NOT_PROCESSED` | `PROOF_OF_REFUND`, `OTHER` | |
| `DUPLICATE_TRANSACTION` | `PROOF_OF_REFUND`, `OTHER` | |
| `INCORRECT_AMOUNT` | `PROOF_OF_REFUND`, `OTHER` | Refund ID for the difference. |
| `PAYMENT_BY_OTHER_MEANS` | `PROOF_OF_REFUND`, `OTHER` | |
| `CANCELED_RECURRING_BILLING` | `PROOF_OF_REFUND`, `OTHER` | e.g. the subscription agreement. |
| `OTHER` | `PROOF_OF_REFUND`, `OTHER` | |

- **Measured in our sandbox (5 Nov):** in the `INQUIRY` stage, an `OTHER` evidence for a not-received dispute was rejected (`EVIDENCE_TYPE_IS_NOT_ALLOWED`); `PROOF_OF_FULFILLMENT` with tracking info + a document + notes was accepted (200). Matches the table.
- **Files:** `.jpg .jpeg .gif .png .pdf` only, each under 10 MB, at most 50 MB per call. (The sandbox accepted a `.txt`; we do not rely on that. Text evidence is bundled into a generated PDF.)
- **One shot:** after evidence is filed the dispute moves to `WAITING_FOR_BUYER_RESPONSE` / review and `provide_evidence` disappears. So the pack must be complete *before* filing. This is why the gate exists.

## 2. The flow

```
PayPal webhook (CUSTOMER.DISPUTE.CREATED / UPDATED / RESOLVED)    or "Sync" (list disputes)
        │  verify signature with PayPal (verify-webhook-signature)
        ▼
  fetch dispute details  ──►  Case: reason, stage, status, amount, deadline, allowed actions, buyer's words
        │
        ▼
  Evidence locker for that transaction (files the seller already has: invoice, delivery log,
  emails, screenshots, contract, refund record).  "Pre-armed": created when the payment is captured
  (PAYMENT.CAPTURE.COMPLETED), so files can be dropped in long before any dispute.
        │
        ▼
  AI reads each file  ──►  Facts, each with the exact words it came from (quote) and the file/page
        │
        ▼
  RULES ENGINE (deterministic, unit-tested)
     • which evidence types are allowed (reason × stage × HATEOAS links)
     • for each type: required items present? (e.g. carrier + tracking, or a delivery document)
     • consistency checks against PayPal's own records: amount, transaction id, buyer, dates
       (delivery before the dispute opened, after payment), refund IDs that really exist
     • verdict:  READY TO FILE  |  MISSING (list exactly what)  |  CONFLICT (evidence contradicts itself
                 or PayPal's records)  |  REFUND IS CHEAPER (no defensible evidence; suggest accept/offer)
        │
        ▼
  AI drafts the seller's statement (notes) ONLY from extracted facts; code checks every sentence
  cites a fact and adds no number, date or name that is not in the facts.
        │
        ▼
  Person reviews: checklist, statement, documents, the exact JSON that will be sent  ──►  Approve
        │
        ▼
  provide-evidence (multipart: input JSON + PDF/image files)  ──►  read the dispute back, show what
  PayPal recorded.  Audit log: who approved, when, what was sent, file hashes.
```

## 3. Components

| Part | Choice | Why |
|---|---|---|
| Server | Node 24 + TypeScript (tsx), Hono | Small, fast to write, one process serves API + web. |
| Store | `node:sqlite` (built into Node 24) | No native build on Windows; one file; enough for a demo. |
| PayPal | REST: OAuth, Disputes v1 (list, show, provide-evidence, accept-claim, make-offer, send-message), Payments v2 (capture, refund lookup), Webhooks (subscribe, verify signature) | The integration *is* the product. |
| AI | Meta Muse Spark 1.3 via the OpenAI-compatible Meta Model API (vision + PDF + JSON schema), any OpenAI-compatible model as fallback | Proven in Substance Proof; strict JSON output with quotes. |
| PDF | `pdf-lib` to build the evidence summary PDF | Pure JS. |
| Web | React + Vite + **AG Grid Community** (MIT) | Dispute queue and evidence checklist grid; AG Grid sponsor prize. |
| Tests | Vitest | Rules engine and guardrails fully covered. |

## 4. Honesty rules for the submission
- All data is sandbox / synthetic. Say so on screen.
- Publish the evaluation, including failures.
- The video shows a real sandbox dispute and a real `provide-evidence` call.
- No claim that ClaimPack "wins" disputes: it measures **completeness and correctness against PayPal's published rules**, not outcomes (PayPal decides outcomes; the sandbox cannot tell us win rates).

## 5. Evaluation (synthetic, published)
A set of synthetic disputes, each with a reason, stage, PayPal records and an evidence folder (generated PDFs/images) containing planted facts, missing items and traps: a tracking number for a different order, delivery dated after the dispute opened, a refund ID that does not exist, an invoice for another buyer, an instruction to the AI hidden in a document. Gold answers: the correct verdict, evidence type, and the facts. Scored: fact extraction, verdict accuracy, and **dangerous errors** (filing an incomplete or contradictory pack, or a statement claiming something no document supports).

## 6. Not in scope (say so)
Live email/inbox ingestion (files are uploaded or dropped in a folder), accounting write-back, predicting win probability, real card-network chargebacks.
