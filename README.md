# Finances: iPhone app for bank statements

All files sit in one folder so they can be uploaded from an iPhone in one go.
These files are only the app's code. They contain no personal data: no names, account or
customer numbers, transactions, or local shops. Those live in your own rules file and in the
phone's storage, never on the website.

To update the app later: upload the changed files and change VERSION in sw.js (e.g. fin-v4).

## Tests

`tests/` holds the automatic checks (`npm install` and `npm test` inside that folder). They use only the invented
data from the mock data ledger in `CLAUDE.md`, and GitHub runs them on every branch and pull request.

## Demo mode (v20)
Settings has a Demo mode that shows made-up data (built only from the mock data ledger in `CLAUDE.md`). Your own data is encrypted and hidden while it runs; exit with Face ID / Touch ID, or with the vault passphrase. Nothing done in the demo is saved.
