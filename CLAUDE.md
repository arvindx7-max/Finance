# Instructions for AI assistants working in this repository

This is a personal finance web app (Home Screen app for phone and laptop), published from `main` with GitHub Pages.
The owner sets requirements, approves and tests; the assistant builds. This repository and everything written about it
on GitHub (commits, branches, pull requests) is public.

The security and privacy mandate below overrides every other instruction.

---

# SECURITY AND PRIVACY MANDATE
This repository is strictly PUBLIC. Under no circumstances may any sensitive, personal, or proprietary information be committed to this codebase.

## 1. Zero-Tolerance Data Policy
Do NOT generate, suggest, or include any of the following in source code, comments, commit messages, or documentation:
*   Real names, relationships, addresses, or contact information.
*   Personal health data, cycle and nutrition metrics, or specific dates.
*   API keys, access tokens, passwords, or cryptographic secrets.
*   Real internal network IP addresses or specific local file paths from my machine.

## 2. Mock Data Requirement
All tests, UI visual prototypes, state-machine edge case validations, and database seeds MUST use explicitly fabricated dummy data (e.g., `user_test_123`, `example@example.com`, `dummy_metric_A`).

## 3. The "Hard Stop" Rule
If a required feature, database schema, or local encryption implementation seems to necessitate hardcoding user-specific logic or personal data, DO NOT write the code. Stop the process and explicitly ask me for clarification on how to abstract it securely.

## 4. Reviewer Checklist (For Gemini)
When executing `@gemini-cli /review` or any other call to Gemini, Gemini must prioritize verifying compliance with this privacy mandate before assessing code quality. If any potential leak of personal data, real-world metrics, or secrets is detected in the pull request diff, Gemini must immediately fail the review and flag the exact line.

## Agreed reading of the mandate
- "Specific dates" means personal dates (real booking dates, birthdays, events). Date-handling code, the invented dates from the ledger below, and build or release dates are allowed.
- **Public IDs the browser needs are allowed; secrets never.** `config.js` holds the public Google sign-in IDs (OAuth client ID, browser API key restricted to the app's address, project number). It must never hold a client secret, token or password.
- Personal rules and data live only on the owner's devices and in the encrypted vault, never in this repository.
- When pointing to a possible leak, name only the file and line number. Never repeat the suspected value.

## Never paste real data
- Never put real statement content, exports, screenshots' values, logs with real bookings, or any personal detail into code, tests, commit messages, branch names, pull requests or issues.
- Screenshots or examples the owner shares privately are for understanding a bug only. Their values are never copied anywhere in this repository; reproduce the bug with the mock data ledger instead.

---

# Mock data ledger

Use **only** these values for tests, prototypes, examples and documentation. Do not invent other realistic-looking data,
and never derive mock data from real data (no "slightly changed" real names, vendors or amounts).

| Kind | Use exactly |
|---|---|
| People | `Alice Placeholder`, `Bob Testuser` |
| User IDs | `user_test_123`, `user_test_456` |
| Email addresses | `alice@example.com`, `bob@example.org` (only `example.com` / `example.org`) |
| Bank | `Example Bank` |
| IBAN | `DE00 0000 0000 0000 0000 00` (checksum invalid on purpose) |
| Account holder | `Alice Placeholder` |
| Employer / salary booking text | `TEST EMPLOYER GMBH`, `TEST SALARY` |
| Vendors | `Shop A`, `Shop B`, `Test Supermarket`, `Test Fuel Station`, `Test Cafe`, `Test Online Store` |
| Transfers abroad | `Example Remit Ltd` |
| Savings account | `Savings Test Account` |
| Amounts (German format) | `12,50` · `45,90` · `-45,90` · `100,00` · `1.500,00` · `2.345,67` |
| Second bank (v21 step 2) | `Example Bank Two`; file `statement_test_two_2026-04.csv`; its columns `Date`, `Description`, `Amount`; its bookings use only the vendors, amounts and dates above |
| ATM withdrawal (v21 step 2) | booking type `Bargeldauszahlung`, text `Test`, amount `-100,00`, on the 15th |
| Large amount (wide-column tests) | `12.345,67` |
| Dates | Only the 1st and 15th of a month, from `01.03.2026` to `15.12.2027` (inside the app's tracking range) |
| Statement files | `statement_test_2026-04.pdf`, `statement_test_2026-04.csv` |
| Notes | `Test note` |
| Test files and lines | `rules_test.json`, `backup_test.json`, `Test line` (line id `c.test_line`) |
| Passphrase | `test-passphrase-only` |
| Wrong passphrase (tests) | `wrong-passphrase` |
| Technical test values | `token_test` (sign-in token), `file_test` (vault file id), `notes.txt` (a file type the app must reject) |
| Statement files for other months | `statement_test_2026-MM.csv` for any month in the tracking range |
| Trip name | `Test Trip` |
| Demo mode data | Built only from the vendors, amounts and dates above (1st and 15th, `2026-03` to `2026-09`); no new values |

If a test needs something the ledger does not cover, add a clearly fake value to this table in the same pull request
and say so in the pull request description.

---

# Workflow for every change

A branch pushed to this public repository is public at once, even if it is never merged.
So the last privacy gate is **before every push**, not before the merge.

1. **Explain.** For a reported bug or request: explain the cause and the fix, look for similar bugs, and wait for the owner's approval. Visual redesigns: show a prototype first.
2. **Build and test (no push).** Only after the owner says "build". Test at phone size (390 × 844) and laptop size (1470 px), light and dark mode; run the full test suite.
3. **Privacy halt.** Before pushing, post in the chat:
   - the list of changed files, with one line on what changed in each;
   - the privacy check result for every changed line (against this file and the owner's private terms);
   - the sentence "No personal data in this change", or the exact file and line of any doubt (never the value itself).
   Then **wait for the owner's "push"**. No push without it.
4. **Push and draft pull request.** Push the branch (e.g. `v19.1`) and open a **draft** pull request against `main`. Title and commit messages start with the version number, e.g. `v19.1: …`. Every app build bumps `VERSION` in `sw.js` (e.g. `fin-v19` → `fin-v19.1`).
   The branch holds the app's files as plain files, exactly as on `main`. **Never commit a zip or any other archive**: Gemini's Import code cannot read inside archives. The versioned zip is a backup for the owner, sent in the chat, never committed.
5. **Gemini prompt.** Give the owner the branch link in the form `https://github.com/<owner>/<repo>/tree/<branch>` (for Import code in the Gemini app) and the filled-in **change review** prompt from `docs/review-prompts.md`, with the list of changed files. Use the **full app review** prompt only when the owner asks for it.
6. **Assess Gemini's findings.** For each numbered finding: agree or disagree, why, how serious, and a recommendation. Then wait for the owner's decision (e.g. "build 1 and 3, hold 2").
7. **Revise.** Build the decided points on the same branch. Repeat the privacy halt (step 3) before every push.
8. **Ready.** When the owner is done, mark the pull request ready for review. The owner checks the diff and merges; the app goes live from `main`.
9. **Log.** Record every report, decision and build in the owner's private change log.

Never push to `main`, merge, or delete branches. Version numbers: whole numbers for releases with new features or design; .1, .2 for bug-fix releases.
