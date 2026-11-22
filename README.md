<img src="docs/brand/shap-icon.svg" alt="" width="72" align="left">

# Shap Pocket

**The books for a one-person business, on your phone.** Quotes, invoices, costs with a photo
of the slip, what clients owe you, VAT and your tax estimate, for South African sole
proprietors and small companies. Free, open source, no account, no subscription.

<br clear="left">

**Get it:** [Google Play](https://play.google.com/store/apps/details?id=za.co.openworks.shappocket)
· iPhone: with Apple for review · on a computer: [openworks.co.za/shap/app](https://www.openworks.co.za/shap/app/),
installed from Edge or Chrome.

Made for the electrician who works alone, the plumber, the designer, the tutor: anyone running
their own business who doesn't want to pay every month for accounting software built for
someone else.

## What it does

- **Quotes and invoices** with your logo, colour and bank details. Send them from the phone
  with WhatsApp, Gmail, Outlook or anything else on it. Turn a quote into an invoice in one tap,
  record payments, see who owes you.
- **Costs**: snap the slip, pick what it was. Import bank statements and tick off what's been
  captured (optional).
- **Jobs** (optional): what a job was quoted, what it cost, what it made.
- **Workers** (optional): a helper's days and pay.
- **Payroll** (optional): employees on a monthly salary, pay runs with PAYE, UIF and SDL from
  SARS's tables, payslips, and the EMP201 each month.
- **Home**: what clients owe you, and this year's revenue,
  gross profit and net profit as the income statement sets them out.
- **Sales** (optional): sell over the counter from a quick item list, take the money, share the
  slip, refund what comes back, make it an invoice for a business customer. (Stock records are
  in full Shap.)
- **The books, done for you**: income statement, balance sheet, assets with wear and tear, year
  end for your accountant, CSV exports, and (optional) the annual financial statements under the
  IFRS for SMEs Accounting Standard, shared with your accountant to compile and sign. **Share your
  books with your accountant** as one file from *Accounts → Export*.
- **Moving in** from Sage, Xero, QuickBooks, Zoho or Invoice Ninja: clients, invoices, what's
  been paid, and the opening balances from your last year end's trial balance.
- **Travel logbook** (optional): SARS's logbook of business trips through the tax year, with the
  odometer and the business share, for your accountant or SARS.
- **Tax**: a provisional tax estimate on SARS's tables (sole proprietor or company), and a
  warning when your income gets near the VAT registration line (R2.3 million from April 2026).
- **Only what you need**: switch off jobs, quotes, workers, bank statements, assets or trading
  names.

## Private by design

Your books live on your phone and nowhere else: there is no Shap server that holds them.
Nothing about you or your business leaves the phone without your yes: a quote you send a client,
a backup to your own cloud drive, feedback you choose to send, or (only if you say yes) an
anonymous note of what kind of business uses Shap, or prices shared anonymously. The app reads OpenWorks' notices file on GitHub, with nothing about you in
the request. You can lock the app with Face ID, your fingerprint or your phone's PIN.

**Back up** from *Backup*: one file, saved through your phone's share sheet to iCloud Drive,
Google Drive, OneDrive or Proton Drive. Restore it on a new phone from the first screen.

## How it works

Shap Pocket is [Shap](https://github.com/OpenWorksIT/shap) (a self-hosted jobs and accounting
app) without the server. The same accounting runs on the phone: the database is
[PGlite](https://pglite.dev) (PostgreSQL compiled to WebAssembly), the screens are React, and
[Capacitor](https://capacitorjs.com) makes it an Android and iPhone app.

```
apps/web          the app: screens, the engine worker, Capacitor (android/, ios/)
packages/engine   the books: routes, PDFs, PGlite layer, migrations, tests
packages/shared   validation, tax tables, money, dates
```

## Building

Node 22.

```bash
npm install
npm test                         # the books, on PGlite
npm run dev                      # the app in a browser, http://localhost:5173
npm -w @shap/web run build       # then: cd apps/web && npx cap sync && npx cap open android|ios
```

Android builds on any OS (Android Studio, JDK 21). iPhone builds need Xcode on a Mac; the
GitHub Actions workflow builds both on every push. Store releases: [docs/app-stores.md](docs/app-stores.md).

## How every update is checked

Like an accountant's continuing professional development, every update goes through the CPD audit
before any phone takes it ([CPDAUDIT.md](CPDAUDIT.md), with Shap's, whose accounting code Pocket
shares): five reviews (security and privacy, IFRS for SMEs and company law, SARS and tax,
accounting and arithmetic, and the words on screen and what they promise), each by a reviewer that
didn't write the change, then the tests and CI.

## Licence

AGPL-3.0-or-later, with an additional permission that allows distribution through app stores
(see [NOTICE](NOTICE)). Copyright © 2026 Complete Construction Solutions (Pty) Ltd t/a
OpenWorks IT. Third-party components: [THIRD-PARTY.md](THIRD-PARTY.md).

Shap Pocket is a free service from OpenWorks IT, who are not accountants, auditors or tax
practitioners. Its tax figures and estimates are worked out from what you capture: they're not
tax, accounting or legal advice. Check them with your accountant or SARS.
