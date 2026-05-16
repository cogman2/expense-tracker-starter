---
name: deploy
description: Deploy the app to staging. Runs the full test suite, builds the production bundle, then pushes the current branch to the `staging` branch on origin. Use when the user says "deploy", "ship to staging", or invokes /deploy.
---

# deploy

Run these steps in order. If any step fails, stop and report the failure — do not proceed to the next step.

## 1. Run tests

```bash
npm test
```

If there is no `test` script in `package.json` (this starter currently has none), tell the user that no tests are configured and ask whether to proceed anyway before continuing.

## 2. Build the production bundle

```bash
npm run build
```

Confirm `dist/` was produced.

## 3. Push to the staging branch

Push the current branch's HEAD to `staging` on `origin`:

```bash
git push origin HEAD:staging
```

If the remote rejects the push as non-fast-forward, stop and ask the user before force-pushing — never force-push without explicit confirmation.

## Reporting

After a successful deploy, report:
- Test result (pass / skipped)
- Build output location
- The commit SHA pushed to `staging`
