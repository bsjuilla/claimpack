# Sources (PayPal developer docs, read 5 Nov 2026)

| Page | URL | Used for |
|---|---|---|
| Dispute reasons and evidence (updated 5 Jun 2026) | https://developer.paypal.com/disputes/reasons-evidence | Evidence types allowed per reason (src/rules/paypalRules.ts) |
| Disputes lifecycle stages (updated 14 Oct 2026) | https://developer.paypal.com/disputes/disputes-lifecycle | Stages, statuses and actions per stage |
| Supported file types and sizes (updated 21 May 2026) | https://developer.paypal.com/disputes/supported-file-sizes-types | .jpg .jpeg .gif .png .pdf, <10 MB each, 50 MB per call |
| Test and go live (updated 17 Aug 2026) | https://developer.paypal.com/disputes/test-go-live | Sandbox dispute creation, webhooks, test values |
| Set up accounts and environment (updated 26 Jun 2026) | https://developer.paypal.com/disputes/set-up | Buyer-side credentials needed for API dispute creation (we create disputes in the sandbox Resolution Center instead) |
| Webhook event names | https://developer.paypal.com/api/rest/webhooks/event-names | CUSTOMER.DISPUTE.CREATED / UPDATED / RESOLVED |
