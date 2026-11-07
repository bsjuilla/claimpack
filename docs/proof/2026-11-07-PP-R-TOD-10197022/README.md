# Proof: the filing shown in the demo video (7 November 2026)

Dispute `PP-R-TOD-10197022` (PayPal sandbox, *item not received*, inquiry stage), filed by ClaimPack after a named person approved it.

| File | What it is |
|---|---|
| `request-sent.json` | The `input` part ClaimPack sent to `provide-evidence`, with the time and PayPal's HTTP status (200) |
| `paypal-dispute-now.json` | The dispute as PayPal's API returns it today, read fresh by `scripts/proof.ts`: the seller evidence `PROOF_OF_FULFILLMENT`, its notes, the document names, status `WAITING_FOR_BUYER_RESPONSE` |
| `files.json` | For each file: the size and SHA-256 ClaimPack logged when it sent it, and the size and SHA-256 of the copy PayPal now holds (downloaded from PayPal's document link). All three files are **identical** |

Emails, account IDs and the approver's name are redacted; PayPal's document download links are removed (they need the seller's credentials anyway). Regenerate with your own sandbox filing: `npx tsx scripts/proof.ts <dispute id>`.
