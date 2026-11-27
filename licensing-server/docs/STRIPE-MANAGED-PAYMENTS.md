# Stripe (cards) on Managed Payments

Stripe is a checkout provider like PayPal and Safepay. The account sells through **Stripe Managed
Payments**: Stripe (through Link) is the merchant of record, works out and pays the sales tax, and
answers the buyer's payment questions. The app lists it as **Stripe (cards)** once its keys are saved
and enabled. The website (browser.softglaze.com/buy) uses it for one-time plans (the lifetime offers),
and the buyer gets an activation code by email.

## How a plan maps to Stripe

The server never makes prices on the fly. Each plan is sold through the Price in the Stripe Product
catalog that has its **lookup key**:

| Plan key | Stripe lookup key | Stripe Price |
| --- | --- | --- |
| `pro` | `pro_monthly` | US$5 per month |
| `pro-yearly` | `pro_yearly` | US$50 per year |
| `pro-lifetime` | `pro_lifetime` | US$49 one time |
| `enterprise` | `enterprise_monthly` | US$29 per month |
| `enterprise-yearly` | `enterprise_yearly` | US$290 per year |
| `enterprise-lifetime` | `enterprise_lifetime` | US$249 one time |

The admin setting `checkout.stripeLookupKeys` (`{ "<plan key>": "<lookup key>" }`) overrides a row.

### Monthly and yearly on the website (optional)

The website can also sell a monthly or yearly plan as **one payment for one term** (an activation code,
no renewal). It does so only when a one-time Price with the plan's amount has this lookup key; without
it the website answers `install_required` and the plan is bought in the app (a subscription).

| Plan key | Website lookup key | Stripe Price (one time) |
| --- | --- | --- |
| `pro` | `pro_month_once` | US$5 |
| `pro-yearly` | `pro_year_once` | US$50 |
| `enterprise` | `enterprise_month_once` | US$29 |
| `enterprise-yearly` | `enterprise_year_once` | US$290 |

Override one with `checkout.stripeLookupKeys` `"web:<plan key>"`. To stop selling a term on the website,
archive its one-time Price.

### The buyer's email

The website may send the buyer straight to Stripe without asking for an email first: Stripe's page asks
for it, and the server takes it from the paid session to send the activation code.

- The Price must charge exactly the plan's amount and currency, and bill per the plan's interval.
  Otherwise checkout is refused (409 `stripe_price_mismatch` / `stripe_price_missing`, logged as
  `[checkout:stripe]`): what the app shows is what the card pays. Change a price in both places.
- A recurring Price opens a subscription (renews until cancelled), a one-time Price a single payment.
- Each Product needs an eligible **Product category (tax code)** set on the product itself, not the
  account preset. We use `txcd_10202003` Downloadable Software, business use. The product page then
  shows **Managed Payments: Eligible**; "Needs info" means the category is missing.
- The server calls Stripe with API version `2025-08-27.basil` (Managed Payments needs basil or later)
  and `managed_payments[enabled]=true` on every Checkout Session.

## 1. Make the keys

In the Stripe Dashboard (live mode for real sales, test mode for a dry run):

1. **Developers > API keys > Create restricted key**, name it `licensing-server`, and give it:
   Checkout Sessions **Write**, Prices **Read**, Products **Read**, Charges **Read**, Invoices **Read**,
   Subscriptions **Read**. Everything else None. (If a checkout fails with a permissions error, the log
   names the missing one.)
2. **Developers > Webhooks > Add endpoint**:

   ```
   https://api.softglaze.com/v1/webhooks/stripe/<tenantId>
   ```

   Events: `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
   `checkout.session.async_payment_failed`, `invoice.paid`, `customer.subscription.deleted`,
   `charge.refunded`, `charge.dispute.created`. Copy the endpoint's **Signing secret** (`whsec_...`).

## 2. Save them on the licensing server

```
POST /v1/tenant/payment-config        (Bearer: the tenant API key)
{
  "provider": "stripe",
  "enabled": true,
  "secretKey": "<rk_live_... or sk_live_...>",
  "webhookSecret": "<whsec_...>"
}
```

Paste the keys yourself (SSH or the admin); they are sealed at rest and never shown again. If the admin
setting `checkout.providers` is a list (not `null`), add `"stripe"` to it.

As soon as Stripe is saved and enabled, `GET /v1/checkout/methods` answers `web.provider: "stripe"`, and
`web.test` is true for a test key (`sk_test_` / `rk_test_`), false for a live key. The website shows
its card form to everyone only when `test` is false.

## 3. Test in test mode first

Save the **test** keys and a test-mode webhook, buy Pro monthly in the app and Pro Lifetime on the
website with card `4242 4242 4242 4242` (any future date, any CVC), then check: the Payment is `paid`
in the admin, the app licence (or the emailed code) is right, and a refund from the Dashboard takes the
term back. Then save the live keys.

## Rules that come with Managed Payments

- Stripe may refund a buyer within **60 days**, whatever our own refund policy says.
- Our terms must link to the Stripe / Link customer terms; Checkout shows Stripe's standard payment terms.
- Answer Stripe's support requests within **48 hours**, or Stripe may refund on its own.
- Coupons and promotion codes are not documented for Managed Payments: sell offers as their own Prices.
- When an offer ends (the lifetime prices end 1 December 2026), archive its Prices in Stripe and end
  the plan's sale window here.
