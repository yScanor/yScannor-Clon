/* yScannor © 2026 — marca d'água: ys-51b312666cb3 */
// Céu estrelado: estrelas piscando + estrelas cadentes aleatórias
(function () {
  const c = document.getElementById('sky'), x = c.getContext('2d');
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let W, H, stars = [], shots = [], dpr = Math.min(window.devicePixelRatio || 1, 2), last = 0, nextShot = 0.4;

  function size() {
    W = innerWidth; H = innerHeight;
    c.width = W * dpr; c.height = H * dpr;
    x.setTransform(dpr, 0, 0, dpr, 0, 0);
    const n = Math.round((W * H) / 2400);
    stars = Array.from({ length: n }, () => ({
      x: Math.random() * W, y: Math.random() * H,
      r: Math.random() * 1.1 + 0.2, p: Math.random() * 6.28, s: 0.8 + Math.random() * 2.2
    }));
  }

  function spawn() {
    const dir = Math.random() < 0.75 ? 1 : -1;
    const a = (Math.PI / 180) * (22 + Math.random() * 28);
    const v = 420 + Math.random() * 480;
    shots.push({
      x: dir === 1 ? Math.random() * W * 0.8 - 40 : W * 0.2 + Math.random() * W * 0.8 + 40,
      y: -10 + Math.random() * H * 0.55,
      vx: Math.cos(a) * v * dir, vy: Math.sin(a) * v,
      len: 70 + Math.random() * 110, life: 0, max: 0.7 + Math.random() * 0.8
    });
  }

  function frame(t) {
    t /= 1000;
    const dt = Math.min(t - last, 0.05); last = t;
    x.clearRect(0, 0, W, H);
    for (const s of stars) {
      const a = 0.35 + 0.65 * Math.abs(Math.sin(t * s.s + s.p));
      x.globalAlpha = a; x.fillStyle = '#fff';
      x.beginPath(); x.arc(s.x, s.y, s.r, 0, 6.283); x.fill();
    }
    nextShot -= dt;
    if (nextShot <= 0) { spawn(); if (Math.random() < 0.25) spawn(); nextShot = 0.5 + Math.random() * 1.8; }
    for (let i = shots.length - 1; i >= 0; i--) {
      const s = shots[i];
      s.life += dt; s.x += s.vx * dt; s.y += s.vy * dt;
      const k = 1 - s.life / s.max;
      if (k <= 0 || s.y > H + 20 || s.x < -200 || s.x > W + 200) { shots.splice(i, 1); continue; }
      const m = Math.hypot(s.vx, s.vy), tx = s.x - (s.vx / m) * s.len, ty = s.y - (s.vy / m) * s.len;
      const g = x.createLinearGradient(s.x, s.y, tx, ty);
      g.addColorStop(0, 'rgba(255,255,255,' + k + ')'); g.addColorStop(1, 'rgba(255,255,255,0)');
      x.globalAlpha = 1; x.strokeStyle = g; x.lineWidth = 1.6; x.lineCap = 'round';
      x.beginPath(); x.moveTo(s.x, s.y); x.lineTo(tx, ty); x.stroke();
      x.fillStyle = 'rgba(255,255,255,' + k + ')'; x.beginPath(); x.arc(s.x, s.y, 1.8, 0, 6.283); x.fill();
    }
    requestAnimationFrame(frame);
  }

  size(); addEventListener('resize', size);
  if (still) { x.fillStyle = '#fff'; stars.forEach(s => { x.globalAlpha = 0.7; x.fillRect(s.x, s.y, s.r, s.r); }); }
  else requestAnimationFrame(frame);
})();
