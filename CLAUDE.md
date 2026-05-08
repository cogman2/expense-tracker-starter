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

React app with two components and no routing.

**Components:**
- `src/App.jsx` — root component; owns all state (transactions, form inputs, filters), handles form submission, filters the transaction list, and renders the transaction table
- `src/Summary.jsx` — presentational component that receives `transactions` as a prop and computes/displays income, expenses, and balance totals

There are no custom hooks, context, or client-side routing.

**Known issues (intentional — part of a course exercise):**
- Transaction #4 ("Freelance Work") is typed as `"expense"` despite being income
- UI styling and code organization are intentionally rough
