/* yScannor © 2026 — marca d'água de autoria: ys-51b312666cb3 */
(function () {
  // ===== CONFIGURAÇÃO ===================================================
  // Coloque aqui SÓ os endereços oficiais do seu site (sem https://).
  // Ex.: ['meusite.com', 'www.meusite.com', 'usuario.github.io']
  var OFFICIAL_HOSTS = [];
  // Endereço oficial completo para onde enviar quem cair numa cópia. Ex.: 'https://meusite.com/'
  var OFFICIAL_URL = '';
  // =====================================================================
  var DEV_HOSTS = ['localhost', '127.0.0.1', '[::1]'];

  // 1) Não permite que o site seja aberto dentro de outro site (iframe/overlay de golpe)
  try {
    if (window.top !== window.self) {
      document.documentElement.style.display = 'none';
      window.top.location.replace(window.self.location.href);
    }
  } catch (e) { document.documentElement.style.display = 'none'; }

  // 2) Trava de domínio: se o site for copiado e servido em outro endereço, avisa e para
  if (!OFFICIAL_HOSTS.length) {
    if (window.console) console.warn('[yScannor] proteção anti-clone INATIVA: preencha OFFICIAL_HOSTS em js/guard.js');
    return;
  }
  var h = (location.hostname || '').toLowerCase();
  if (location.protocol === 'file:' || DEV_HOSTS.indexOf(h) > -1) return;
  for (var i = 0; i < OFFICIAL_HOSTS.length; i++) if (h === String(OFFICIAL_HOSTS[i]).toLowerCase()) return;

  try { window.stop(); } catch (e) {}
  var link = OFFICIAL_URL ? '<p><a href="' + OFFICIAL_URL + '">' + OFFICIAL_URL + '</a></p>' : '';
  document.open();
  document.write('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Cópia não oficial</title>' +
    '<body style="margin:0;background:#000;color:#fff;font:16px/1.5 system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;text-align:center;padding:24px">' +
    '<main style="max-width:480px;border:2px solid #fff;padding:28px;box-shadow:6px 6px 0 #555">' +
    '<h1 style="font:900 italic 32px/1.1 Impact,\'Arial Black\',sans-serif;margin:0 0 12px">Cópia não oficial</h1>' +
    '<p>Este endereço <b>não</b> pertence ao yScannor. Não digite senhas, dados pessoais nem pagamentos aqui.</p>' + link +
    '<p style="color:#8a8a8a;font-size:12px">© 2026 yScanor. Todos os direitos reservados.</p></main></body>');
  document.close();
  if (OFFICIAL_URL) setTimeout(function () { location.replace(OFFICIAL_URL); }, 6000);
})();
