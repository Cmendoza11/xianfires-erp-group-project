const paper = document.getElementById('receipt-paper');
const style = document.getElementById('receipt-paper-style');
if (paper && style) {
  try { paper.value = localStorage.getItem('djyum-receipt-paper') === '58' ? '58' : '80'; } catch {}
  const update = () => {
    const width = paper.value === '58' ? 58 : 80;
    style.textContent = `@media print {
      @page { size: auto; margin: 3mm; }
      html, body { width: ${width - 6}mm; margin: 0 !important; padding: 0 !important; }
      body, .receipt, .receipt * { color: #000 !important; background: #fff !important; }
      .receipt { box-sizing: border-box; width: 100% !important; max-width: none !important; padding: 0 !important; }
      .receipt table { table-layout: fixed; width: 100%; }
      .receipt th:first-child { width: 40%; }
      .receipt td { overflow-wrap: anywhere; }
      .receipt tr { break-inside: avoid; }
    }`;
    try { localStorage.setItem('djyum-receipt-paper', String(width)); } catch {}
  };
  paper.addEventListener('change', update);
  update();
}
