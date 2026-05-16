function formatMoney(value) {
  const abs = Math.abs(value);
  const whole = Math.floor(abs).toLocaleString('en-US');
  const cents = (abs % 1).toFixed(2).slice(2);
  return { whole, cents, negative: value < 0 };
}

function Figure({ value, currency = '$' }) {
  const { whole, cents, negative } = formatMoney(value);
  return (
    <span>
      <span className="currency">{negative ? '−' : ''}{currency}</span>
      {whole}
      <span className="cents">.{cents}</span>
    </span>
  );
}

function Summary({ transactions }) {
  const totalIncome = transactions
    .filter(t => t.type === "income")
    .reduce((sum, t) => sum + parseFloat(t.amount), 0);

  const totalExpenses = transactions
    .filter(t => t.type === "expense")
    .reduce((sum, t) => sum + parseFloat(t.amount), 0);

  const balance = totalIncome - totalExpenses;
  const positive = balance >= 0;
  const ratio = totalIncome > 0
    ? Math.round((totalExpenses / totalIncome) * 100)
    : null;

  return (
    <section className="standing reveal reveal-2">
      <div className="standing-cell income small">
        <div className="standing-label">Receipts</div>
        <div className="standing-figure">
          <Figure value={totalIncome} />
        </div>
        <div className="standing-footnote">
          <strong>Credited</strong> &nbsp;to the books this period.
        </div>
      </div>

      <div className="standing-cell expense small">
        <div className="standing-label">Outlays</div>
        <div className="standing-figure">
          <Figure value={totalExpenses} />
        </div>
        <div className="standing-footnote">
          <strong>Debited</strong> &nbsp;against the standing balance.
        </div>
      </div>

      <div className={`standing-cell lead ${positive ? 'positive' : 'negative'}`}>
        <div className="standing-label">The Balance</div>
        <div className="standing-figure">
          <Figure value={balance} />
        </div>
        <div className="standing-footnote">
          <strong>{positive ? 'In the Black' : 'In the Red'}</strong>
          {ratio !== null && (
            <> &nbsp;· outlays consumed <em>{ratio}%</em> of receipts.</>
          )}
        </div>
      </div>
    </section>
  );
}

export default Summary;
