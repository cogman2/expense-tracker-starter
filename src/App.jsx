import { useState } from 'react'
import './App.css'
import Summary from './Summary'

const ROMAN = ['0','I','II','III','IV','V','VI','VII','VIII','IX','X',
  'XI','XII','XIII','XIV','XV','XVI','XVII','XVIII','XIX','XX',
  'XXI','XXII','XXIII','XXIV','XXV','XXVI','XXVII','XXVIII','XXIX','XXX'];

function toRoman(n) {
  if (n < ROMAN.length) return ROMAN[n];
  const map = [
    [1000,'M'],[900,'CM'],[500,'D'],[400,'CD'],[100,'C'],[90,'XC'],
    [50,'L'],[40,'XL'],[10,'X'],[9,'IX'],[5,'V'],[4,'IV'],[1,'I']
  ];
  let s = '';
  for (const [v, sym] of map) {
    while (n >= v) { s += sym; n -= v; }
  }
  return s;
}

function formatLongDate(d = new Date()) {
  const day = d.getDate();
  const ord = (() => {
    const v = day % 100;
    if (v >= 11 && v <= 13) return 'th';
    switch (day % 10) {
      case 1: return 'st';
      case 2: return 'nd';
      case 3: return 'rd';
      default: return 'th';
    }
  })();
  const weekday = d.toLocaleDateString('en-US', { weekday: 'long' });
  const month = d.toLocaleDateString('en-US', { month: 'long' });
  return `${weekday}, the ${day}${ord} of ${month}, ${d.getFullYear()}`;
}

function App() {
  const [transactions, setTransactions] = useState([
    { id: 1, description: "Salary", amount: 5000, type: "income", category: "salary", date: "2025-01-01" },
    { id: 2, description: "Rent", amount: 1200, type: "expense", category: "housing", date: "2025-01-02" },
    { id: 3, description: "Groceries", amount: 150, type: "expense", category: "food", date: "2025-01-03" },
    { id: 4, description: "Freelance Work", amount: 800, type: "expense", category: "salary", date: "2025-01-05" },
    { id: 5, description: "Electric Bill", amount: 95, type: "expense", category: "utilities", date: "2025-01-06" },
    { id: 6, description: "Dinner Out", amount: 65, type: "expense", category: "food", date: "2025-01-07" },
    { id: 7, description: "Gas", amount: 45, type: "expense", category: "transport", date: "2025-01-08" },
    { id: 8, description: "Netflix", amount: 15, type: "expense", category: "entertainment", date: "2025-01-10" },
  ]);

  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [type, setType] = useState("expense");
  const [category, setCategory] = useState("food");
  const [filterType, setFilterType] = useState("all");
  const [filterCategory, setFilterCategory] = useState("all");

  const categories = ["food", "housing", "utilities", "transport", "entertainment", "salary", "other"];

  let filteredTransactions = transactions;
  if (filterType !== "all") {
    filteredTransactions = filteredTransactions.filter(t => t.type === filterType);
  }
  if (filterCategory !== "all") {
    filteredTransactions = filteredTransactions.filter(t => t.category === filterCategory);
  }

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!description || !amount) return;

    const newTransaction = {
      id: Date.now(),
      description,
      amount,
      type,
      category,
      date: new Date().toISOString().split('T')[0],
    };

    setTransactions([...transactions, newTransaction]);
    setDescription("");
    setAmount("");
    setType("expense");
    setCategory("food");
  };

  const handleDelete = (id) => {
    if (!window.confirm("Strike this entry from the ledger?")) return;
    setTransactions(transactions.filter(t => t.id !== id));
  };

  const formatRowDate = (iso) => {
    const [y, m, d] = iso.split('-');
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return `${parseInt(d, 10)} ${months[parseInt(m, 10) - 1]} ${y.slice(-2)}`;
  };

  const issueNo = toRoman(transactions.length);
  const today = new Date();

  return (
    <div className="paper">
      <header className="masthead reveal reveal-1">
        <div className="masthead-meta">
          <span>Vol. I · No. {issueNo}</span>
          <span className="center"><em>Price</em> · One Penny</span>
          <span>Est. MMXXVI</span>
        </div>

        <h1 className="masthead-title">
          The Personal<span className="ampersand">&nbsp;&amp;&nbsp;</span>Ledger
        </h1>

        <div className="masthead-rule" aria-hidden="true">
          <span></span><span></span><span></span>
        </div>

        <p className="masthead-tagline">
          {formatLongDate(today)}
          <span className="ornament">❦</span>
          A private accounting of receipts and outlays
        </p>
      </header>

      <div className="reveal reveal-2">
        <div className="section-head">
          <span className="section-numeral">§ i.</span>
          <h2 className="section-title">The Standing</h2>
          <span className="section-meta">As of {today.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
        </div>
      </div>

      <Summary transactions={transactions} />

      <div className="reveal reveal-3">
        <div className="section-head">
          <span className="section-numeral">§ ii.</span>
          <h2 className="section-title">New Entry</h2>
          <span className="section-meta">File a record below</span>
        </div>

        <form className="new-entry" onSubmit={handleSubmit}>
          <div className="entry-grid">
            <div className="entry-field">
              <label htmlFor="f-desc">Description</label>
              <input
                id="f-desc"
                type="text"
                placeholder="e.g. coffee at Caffè Reggio"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
            <div className="entry-field">
              <label htmlFor="f-amt">Amount</label>
              <input
                id="f-amt"
                type="number"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
            <div className="entry-field">
              <label htmlFor="f-type">Kind</label>
              <select id="f-type" value={type} onChange={(e) => setType(e.target.value)}>
                <option value="income">Income</option>
                <option value="expense">Expense</option>
              </select>
            </div>
            <div className="entry-field">
              <label htmlFor="f-cat">Ledger</label>
              <select id="f-cat" value={category} onChange={(e) => setCategory(e.target.value)}>
                {categories.map(cat => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>
            </div>
            <button type="submit" className="entry-submit">File Entry</button>
          </div>
        </form>
      </div>

      <div className="reveal reveal-4">
        <div className="section-head">
          <span className="section-numeral">§ iii.</span>
          <h2 className="section-title">The Ledger</h2>
          <span className="section-meta">
            {filteredTransactions.length} of {transactions.length} entries
          </span>
        </div>

        <div className="ledger-controls">
          <span className="prefix">Show entries</span>
          <select value={filterType} onChange={(e) => setFilterType(e.target.value)}>
            <option value="all">of every kind</option>
            <option value="income">credited as income</option>
            <option value="expense">debited as expense</option>
          </select>
          <span className="prefix">filed under</span>
          <select value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)}>
            <option value="all">any ledger</option>
            {categories.map(cat => (
              <option key={cat} value={cat}>{cat}</option>
            ))}
          </select>
        </div>

        <table className="ledger-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Particulars</th>
              <th>Folio</th>
              <th className="center">Kind</th>
              <th className="right">Amount</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filteredTransactions.length === 0 && (
              <tr className="empty-row">
                <td colSpan={6}>
                  <span className="ornament">⁂</span>
                  No entries match the present filters.
                </td>
              </tr>
            )}
            {filteredTransactions.map(t => (
              <tr key={t.id} className={t.type === 'income' ? 'is-income' : 'is-expense'}>
                <td className="cell-date">{formatRowDate(t.date)}</td>
                <td className="cell-desc">{t.description}</td>
                <td className="cell-cat">{t.category}</td>
                <td className="cell-type">
                  <span className={`type-pill ${t.type}`}>{t.type === 'income' ? 'Cr.' : 'Dr.'}</span>
                </td>
                <td className={`cell-amount ${t.type}`}>
                  {t.type === 'income' ? '+' : '−'}${Number(t.amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </td>
                <td className="cell-actions">
                  <button
                    className="delete-btn"
                    onClick={() => handleDelete(t.id)}
                    aria-label="Strike entry"
                    title="Strike entry"
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <footer className="colophon reveal reveal-5">
        <span>Set in Fraunces, Newsreader &amp; JetBrains Mono</span>
        <span className="ornament">— ❦ —</span>
        <span>Printed in the Browser</span>
      </footer>
    </div>
  );
}

export default App
