# Shap Pocket's CPD audit

Shap Pocket keeps a one-person business's books on their phone, and its accountant signs what it
draws up. Like an accountant's continuing professional development, every update is checked the
way the profession would check it before any phone takes it. Pocket shares Shap's accounting code
(`packages/shared`, `packages/engine` from Shap's `apps/server`), so it goes through Shap's CPD
audit ([OpenWorksIT/shap: CPDAUDIT.md](https://github.com/OpenWorksIT/shap/blob/main/CPDAUDIT.md)),
with what's Pocket's own below.

## 1. Every update: the five reviews

Before the version goes up and the update is pushed, the five reviews of Shap's CPD audit, each
by someone (or a separate AI session) that didn't write the change, each finding fixed with a test
that fails without it, here and in Shap where the code is shared:

1. **Security and privacy**: for Pocket, what runs in the app. Nothing server-only in the engine
   (it runs in a web worker, where Node's modules are empty stand-ins: the tests check no engine
   file imports one), the database worker answering only the app's own page and loading the empty
   books only from the app's own file, nothing personal leaving the phone without the owner's yes
   (`.github/hosts.json`, `scripts/privacy-hosts.mjs`), the store builds and what the stores'
   privacy labels say (docs/app-stores.md).
2. **IFRS for SMEs and company law**: the statements, as in Shap (Shap's docs/IFRS.md).
3. **SARS and tax**: every figure in Shap's docs/SARS.md, the same here.
4. **Accounting and arithmetic**: every figure the same wherever it goes, and data safety on
   upgrade: books from the version before open (the migrations, `packages/engine/migrations`) and
   give the same figures, and what was signed stays signed.
5. **Words on screen and liability** (from 1.10): everything the app, its PDFs, its store
   listings (docs/app-stores.md) and its docs say to the owner, read as the owner would read it
   and as someone holding OpenWorks IT to it would, as in Shap's: a free app from people who
   aren't accountants, tax practitioners, auditors or labour lawyers, so nothing reads as advice,
   a promise or a figure to rely on; estimates, checks and reminders say so.

Then CI is green on the commit (`apps.yml`: the typecheck, every test, known vulnerabilities and
the privacy list, and the Android and iPhone builds; `web.yml`; CodeQL), and the changelog says
what changed.

## 2. When SARS changes something

The standard update of Shap's CPD audit (section 2), with Shap's: the tables are in the shared code
(`packages/shared/src/tax.ts`, `payroll.ts`, `vat.ts`), copied here. From 1 March each year the
tests fail until the new tax year's figures are checked (`SARS_CHECKED_TO`), and the home screen
tells the owner when this version's tables end before the tax year they're in.

## 3. What each review found

Shap's CPD audit (section 7) has each review; what was Pocket's own:

- **1.5.1**: the first code scanning (CodeQL): the engine's router let a query parameter called
  `__proto__` reach the query object's prototype; the database worker would load the empty books
  from any address the page gave it, and didn't check where a message came from. All fixed.
- **1.7.0**: the statements' fingerprint used node:crypto, an empty stand-in in the app, so
  uploading the signed compiler's report or approving failed there (from 1.6): SHA-256 in plain
  JavaScript now, and the tests check the engine imports nothing of Node's.
- **1.7.2**: Shap 1.23.2's SARS review and its four reviews (Shap's section 7) apply here: the same
  code, fixed the same way, with the tests in `packages/engine/test/sbc-and-sars.test.ts`. What was
  about staff (provisional tax kept from payroll staff) doesn't arise: Pocket has one person.
- **1.8.0**: Shap 1.24's four reviews (Shap's section 7) apply here: the same code, fixed the same
  way, with the tests in `packages/engine/test/sales-invoices-locks.test.ts` and
  `four-reviews.test.ts`. Locking is the owner's (one person: no task to give); what was about
  staff (a teller's stock history, who reopened the books) and the races on the lock (Pocket runs
  one change at a time) don't arise here.
- **1.9.0**: Shap 1.25's IFRS review (Shap's section 7) applies here: the statements' going-concern,
  later-distributions and stock-on-hand checks, and the statement of changes in equity naming a
  CC's, trust's or co-op's capital, with the tests in
  `packages/engine/test/review-1.9-statements-checks.test.ts`. Shap 1.25's test server (made-up
  books, filled and wiped on a server) is Shap's only: nothing of it is in Pocket.
- **1.10.0**: Shap 1.26's five reviews (Shap's section 7) apply here: the same code, fixed the same
  way (migration `043_vat_period_locks.sql`), with the tests in
  `packages/engine/test/review-1.10-vat-period-locks.test.ts` and
  `review-1.10-casual-labour.test.ts`. The first words on screen and liability review read
  Pocket's screens too.
- **1.10.1**: from 1.1.0, Send on a quote, pro-forma, invoice or credit note (on its screen and in
  its preview) failed with "Something went wrong": a `useCallback` for the new PDF preview was
  pasted a second time inside the Send button's action (React refuses a hook there, so it threw
  before the PDF was made, and nothing was shared or marked sent). The type check and the
  engine's tests couldn't see it: the screens had no test. Now
  `packages/engine/test/web-hooks.test.ts` reads every screen with TypeScript's parser and fails on
  a hook outside a component or hook (it fails on 1.10.0's `Document.tsx:290`); Shap's screens have
  the same check (Shap's Send never had the line). Found in use, on a phone. Released before its
  reviews, at OpenWorks' call (Send was broken); the reviews' findings are 1.10.2.
- **1.10.2**: the five reviews of 1.10.1, each by a separate agent, fixed with tests
  (`packages/engine/test/review-1.10.1-send.test.ts`, `web-actions.test.ts`, and more cases in
  `web-hooks.test.ts`); Shap 1.26.1 has the same fixes:
  - IFRS and SARS: Send on a draft invoice or credit note shared a PDF headed "Tax invoice" (or
    "Credit note") asking to be paid, for a supply not in the books or the VAT201, and issuing's
    checks (s20(4), s21(3)) never ran. Send asks to issue it first, and a draft's PDF says "Draft
    invoice" or "Draft credit note", without the payment details.
  - Accounting: Send (and Preview, Open in another app) carried on when the save before it was
    refused, sharing the PDF as last saved. They stop now; `web-actions.test.ts` finds an action
    that swallows its own errors awaited inside another.
  - SARS: the message called a document a tax invoice from today's VAT registration, not its own
    VAT rate as its PDF does: both from the shared `documentName`/`documentHeading`.
  - IFRS and SARS: the delete warning read `sharedAt`, which the API doesn't have, so a draft that
    was shared never warned it had gone out: `sentAt`, typed, through `hasGoneOut`.
  - Words: "Something went wrong" told the owner nothing and lost the cause. One wording
    (`UNEXPECTED`: report it under Feedback, no "try again"), and the error into Feedback's trail;
    checked in every screen. The 1.10.1 entry promised the fault "can't come back" and didn't say
    what to do: it says to send again, and, for a VAT vendor, to check what was issued since.
  - Security and privacy: nothing to fix in 1.10.1 (the share sheet is the owner's yes; the PDF
    goes through a FileProvider that isn't exported). The hooks check now also finds a hook
    imported under another name, called on any namespace, or in a handler named like a component.
  - The fixes, checked by a separate agent: the books' own unexpected error still said "Something
    went wrong. Please try again." (and the screens' fallback too), and its cause never reached
    the trail: now `UNEXPECTED` from `@shap/shared` everywhere, the books send back what kind of
    fault it was (`causeOf`: its kind and code, never its words, which can quote what was typed,
    and Feedback says nothing typed goes) and the screen logs it with the route, and the wording
    check reads the books too. A voided invoice
    still asked to be paid on its PDF and in the message: only an issued invoice (and a
    pro-forma) asks now (`asksForPayment`). The message's payment lines had no test: they're made
    in the shared `shareMessage` now, tested; Send's wiring (asking first, reloading after "Issue
    and send", `hasGoneOut`) is read from the source by `web-actions.test.ts`. "Asks for no
    payment" overstated it (a draft still shows its due date and terms): "without your payment
    details". `pocket.test.ts` issues an invoice, so it ends with `expectCleanAudit`.
- **1.11.0** (Share your books with your accountant; Shap 1.29's five reviews, each reading both
  apps: Shap's section 7, "The five reviews of 1.29 and Shap Pocket 1.11"): the share carried only
  postings, so the accountant's Shap worked the VAT201s, payroll, tax and statements out from less
  than Pocket has: it carries the books' records now (`SHARE_TABLES` in the shared
  pocket-share.ts, employees' ID, tax and bank numbers, contact details, photos and the phone's
  user left out), with every entry's hashes and these books' own id (migration 044), checked
  against Shap's schema before it's offered. Pocket's own: the last share's marks were read back
  with their keys renamed by the database layer, so credit notes, write-offs and the like counted
  as changed every time (kept as text now); lines in a different order changed an entry's hash
  (sorted); an entry moved to another day counted as one gone and one new (once); the panel's
  words (`SHARE_WHAT_GOES`), "Last shared" dated in South Africa, the share sheet's message, the
  balance refusal; the cited holiday's address on the hosts list; the phone's "Owner" placeholder
  is never named to approve the statements; and from the shared statements code, a cost put right
  as an asset by journal is an asset bought, and books that begin with a move-in's opening
  balances say so. Tests: `share.test.ts`, `shared-statements-1.28.test.ts`,
  `shared-fixes-1.28.test.ts`. The fixes, checked by a separate agent (Shap's section 7, "The
  fixes, checked"): the panel said a share held only what was dated to the day and left out every
  tax number and address, where its records go whatever their dates and carry the business's tax
  numbers and its statements' details: each share is now the whole of the books, every entry
  hashed whatever its date (`shareEntries`), the words say what goes and what doesn't, and the
  brand's address and the trips' places stay on the phone (`SHARE_TABLES`); the read limits Shap
  holds a file to are checked here before one is offered (`shareProblem`, shared); the share sheet
  says "as at". In Shap, a second share from books with a counter sale, a refund or stock records
  was refused: fixed there. Tests: `share-file.test.ts` (the words held to a file; it also makes
  Shap's fixtures, both shares of one set of books, with a counter sale part refunded). Checked
  again by another agent: the saved tax estimates (a sole proprietor's income from elsewhere,
  retirement contributions and age) and the logbook's vehicle went too, unsaid: both stay on the
  phone now; the words say which address stays, that a trip's reason goes, and send or save (the
  web app on a computer downloads it). The share-file test makes both and finds neither.
- **1.11.1** (Shap 1.30's five reviews, Shap's section 7, "The five reviews of 1.30 and Shap Pocket
  1.11.1"): from the accounting code Pocket shares, a bank line matched to a bill's payment showed
  as open for good (`matchesFor` had no label for one), matches accepted from the suggestions
  weren't in the audit log, and a compiled set could have another compiler's report uploaded over
  it without the signed one being kept: all fixed as in Shap. Tests: `accounting.test.ts`,
  `bank.test.ts`, `sales.test.ts`, each failing without its fix. Linking an accountant (Shap's own
  server) doesn't arise: Pocket shares its books by file.
- **1.11.2** (with Shap 1.31): the compiler's report is titled "Practitioner's compilation report",
  as ISRS 4410 (Revised)'s example reports title it (left from Shap 1.29.1's reviews for Shap and
  Pocket together). Test: `review-1.7.test.ts`, failing on the old title. Shap 1.31's five reviews
  (Shap's CPDAUDIT.md, "The five reviews of 1.31 and Shap Pocket 1.11.2") then found the report
  shared with Shap short of ISRS 4410 (Revised) for a special purpose framework (para 40(j),
  Illustration 2: a sole proprietor's, a partnership's or a trust's statements may not be suitable
  for other purposes), saying "you" to a company's shareholders and a co-op's members for what the
  directors provide (para 40(c)-(d)), and naming only the standard in its limitation sentence; and
  the screens still said "compiler's report". Fixed as in Shap (`statements/pdf.ts`,
  `statements/details.ts`: `reportAddressee`, `addresseeIsntManagement`, `specialPurposeFor`, the
  last also note 1's "the owner" for a sole proprietor). Test: `shap-1.31-report.test.ts`, each
  failing on 1.11.1. Shap's check of the fixes: a trust's statements are for its trustees, its
  beneficiaries and SARS (note 1 and the report); its test fails on `bf45da7`.
- **1.11.3** (with Shap 1.32): from Shap 1.32's IFRS and SARS reviews, in the shared code: time not
  invoiced by the year end listed for the accountant (IFRS for SMEs 23.14) and the revenue policy
  worded to fit; the agent's amount as no supply in the exempt option's hint (VAT Act s54(2)); the
  professional-services rule for turnover tax (Sixth Schedule para 3(b)) in setup, Settings and the
  cautions. Shap Accountant's setup is Shap's own (Pocket has no practice). The check of the fixes:
  time invoiced through a quote counts as invoiced, and only the year's time (and earlier time
  invoiced after the year end) is listed; the turnover tax rule names a company's investment income.
  The third round: the unbilled-time query finds each entry's invoice by a join, not a search of
  every invoice for each (Shap's speed test covers the shared query); the exempt hint says an agent's
  amount is neither supply nor revenue and stays off the invoice. Test: `shap-1.32.test.ts`, failing
  on 1.11.2.
