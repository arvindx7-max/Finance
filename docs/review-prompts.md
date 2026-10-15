# Gemini review prompts

Claude fills in the parts in `{curly brackets}` and gives the finished prompt to the owner.
The owner opens the Gemini app, chooses the model, uses **Import code** with the branch link, and pastes the prompt.
Gemini's answer is pasted back into the Claude chat unchanged.

---

## 1. Change review (default, for every build)

```
You are reviewing a change to a personal finance web app (a Home Screen web app for phone and laptop).
The imported code is the branch {branch name}, which is version {version}.

SCOPE
Review ONLY these changes. Use the rest of the code only as context to understand them.
{list of changed files, each with one line on what changed}

STEP 1 – PRIVACY (always first)
The repository is public. Check the changed lines for anything personal: real names, relationships,
addresses, contact details, account numbers or IBANs, real amounts or booking dates, shops or services
that point to one person, keys, tokens, passwords, local file paths.
Allowed: the mock data in the "Mock data ledger" of CLAUDE.md, and the public Google sign-in IDs in config.js.
Never repeat a suspected value; give only the file, line and category.

STEP 2 – CODE
In this order: bugs and logic errors; risk of losing or wrongly converting stored data; security of
stored data; behaviour at 390 × 844 and 1470 px wide, in light and dark mode; readability.
Ignore pure style preferences.

OUTPUT – exactly this format, nothing before or after:
PRIVACY: PASS   (or)   PRIVACY: FAIL
Privacy findings:
- {file}, line {n}: {category}   (or "None")
Findings:
1. [high|medium|low] {file}, line {n}: {problem}. Fix: {suggested fix}
2. ...
Ideas (optional, at most 3):
I1. {idea}
```

---

## 2. Full app review (only when the owner asks)

```
You are reviewing a whole personal finance web app (a Home Screen web app for phone and laptop).
The imported code is the branch {branch name}, which is version {version}.

STEP 1 – PRIVACY (always first)
The repository is public. Check all files for anything personal: real names, relationships,
addresses, contact details, account numbers or IBANs, real amounts or booking dates, shops or services
that point to one person, keys, tokens, passwords, local file paths.
Allowed: the mock data in the "Mock data ledger" of CLAUDE.md, and the public Google sign-in IDs in config.js.
Never repeat a suspected value; give only the file, line and category.

STEP 2 – REVIEW
Bugs and logic errors; data safety and security; behaviour at 390 × 844 and 1470 px wide, in light and
dark mode; user experience and interface (clarity, navigation, consistency); calculation logic;
then ideas for useful improvements. Ignore pure style preferences.

OUTPUT – exactly this format, nothing before or after:
PRIVACY: PASS   (or)   PRIVACY: FAIL
Privacy findings:
- {file}, line {n}: {category}   (or "None")
Findings (at most 15, most important first):
1. [high|medium|low] {file}, line {n}: {problem}. Fix: {suggested fix}
2. ...
Ideas (at most 5):
I1. {idea}
```
