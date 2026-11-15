/* yScannor © 2026 — marca d'água: ys-51b312666cb3 */
// Efeitos yScannor: tela invertida ao clicar, linhas de velocidade e glitch durante a clonagem
(function () {
  document.querySelectorAll('.lang-menu').forEach(function (m) {
    var t = m.querySelector('.lang-trigger');
    if (t) t.addEventListener('click', function (e) { e.stopPropagation(); m.classList.toggle('open'); });
  });
  document.addEventListener('click', function () {
    document.querySelectorAll('.lang-menu.open').forEach(function (m) { m.classList.remove('open'); });
  });
  var b = document.body, panel = document.getElementById('progressPanel'), icon = document.getElementById('progressIcon'),
    form = document.getElementById('clonerForm'), h1 = document.querySelector('.hero-copy h1'), was = false;
  if (h1) h1.setAttribute('data-text', h1.textContent.trim());
  function impact(ms) { b.classList.add('impact'); setTimeout(function () { b.classList.remove('impact'); }, ms || 130); }
  if (form) form.addEventListener('submit', function () { impact(130); });
  if (!panel || !icon) return;
  function sync() {
    var run = panel.classList.contains('active') && !icon.classList.contains('done') && !icon.classList.contains('error');
    b.classList.toggle('scanning', run);
    if (was && !run) impact(90);
    was = run;
  }
  var mo = new MutationObserver(sync);
  mo.observe(panel, { attributes: true, attributeFilter: ['class'] });
  mo.observe(icon, { attributes: true, attributeFilter: ['class'] });
  sync();
})();
