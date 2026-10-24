() => {
  const parse = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(',').map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
  const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const bgOf = (el) => { let n = el; while (n && n !== document.documentElement) { const c = parse(getComputedStyle(n).backgroundColor); if (c && c.a > 0.5) return c; n = n.parentElement; } return { r: 255, g: 255, b: 255, a: 1 }; };
  const tid = (el) => { let n = el; while (n) { if (n.dataset && n.dataset.testid) return n.dataset.testid; n = n.parentElement; } return ''; };
  const low = []; const lightBlocks = [];
  const all = Array.from(document.querySelectorAll('body *'));
  for (const el of all) {
    const r = el.getBoundingClientRect(); if (r.width === 0 || r.height === 0) continue;
    const cs = getComputedStyle(el); if (cs.visibility === 'hidden' || cs.opacity === '0') continue;
    const txt = Array.from(el.childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim();
    if (txt) {
      const fg = parse(cs.color); const bg = bgOf(el);
      if (fg) { const L1 = lum(fg), L2 = lum(bg); const cr = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
        if (cr < 3) low.push(`${cr.toFixed(2)} "${txt.slice(0, 40)}" fg=${cs.color} bg=rgb(${bg.r},${bg.g},${bg.b}) tid=${tid(el)}`); }
    }
    const b = parse(cs.backgroundColor);
    if (b && b.a > 0.5 && lum(b) > 0.6 && r.width * r.height > 1500) lightBlocks.push(`light-bg ${cs.backgroundColor} ${Math.round(r.width)}x${Math.round(r.height)} tid=${tid(el)} text="${(el.innerText || '').slice(0, 30).replace(/\n/g, ' ')}"`);
  }
  return { low: [...new Set(low)].slice(0, 25), lightBlocks: [...new Set(lightBlocks)].slice(0, 15) };
}
