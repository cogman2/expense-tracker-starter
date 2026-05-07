# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

> Node.js v20.19+ or v22.12+ is required. If using nvm: `source ~/.nvm/nvm.sh && nvm use 24`

```bash
npm install       # install dependencies
npm run dev       # start dev server at http://localhost:5173
npm run build     # production build
npm run lint      # run ESLint
npm run preview   # preview production build
```

## Architecture

This is a single-file React app — all state, logic, and UI live in `src/App.jsx`. There are no separate components, hooks, or routing.

**Known issues (intentional — part of a course exercise):**
- `amount` is stored as a string in state, causing the income/expense totals to use string concatenation instead of numeric addition (`totalIncome` and `totalExpenses` will be wrong)
- Transaction #4 ("Freelance Work") is typed as `"expense"` despite being income
- UI styling and code organization are intentionally rough
