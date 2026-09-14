// Mobu Race — dependency-free canvas confetti for the winner celebration.

const COLORS = ['#ffc93c', '#ff8c42', '#7fd8be', '#f472b6', '#8ab6f9', '#b98cf7', '#ff6b6b', '#9bd45f'];

export function createConfetti(canvas) {
  const ctx = canvas.getContext('2d');
  let raf = null;
  let parts = [];
  let last = 0;

  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }

  function spawn(n) {
    for (let i = 0; i < n; i++) {
      parts.push({
        x: Math.random() * canvas.width,
        y: -20 - Math.random() * canvas.height * 0.25,
        vx: (Math.random() - 0.5) * 50,
        vy: 70 + Math.random() * 110,
        size: 6 + Math.random() * 9,
        rot: Math.random() * Math.PI * 2,
        vr: (Math.random() - 0.5) * 7,
        sway: Math.random() * Math.PI * 2,
        color: COLORS[(Math.random() * COLORS.length) | 0],
      });
    }
  }

  function frame(ts) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (ts - last) / 1000 || 0.016);
    last = ts;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (parts.length < 220) spawn(Math.ceil(dt * 70)); // steady stream
    for (const p of parts) {
      p.sway += dt * 3;
      p.x += (p.vx + Math.sin(p.sway) * 35) * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      if (p.y > canvas.height + 30) {
        p.y = -20;
        p.x = Math.random() * canvas.width;
      }
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 3, p.size, p.size * 0.66);
      ctx.restore();
    }
  }

  function start() {
    resize();
    window.addEventListener('resize', resize);
    parts = [];
    spawn(140);
    canvas.classList.remove('hidden');
    if (!raf) {
      last = performance.now();
      raf = requestAnimationFrame(frame);
    }
  }

  function stop() {
    if (raf) cancelAnimationFrame(raf);
    raf = null;
    parts = [];
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    canvas.classList.add('hidden');
    window.removeEventListener('resize', resize);
  }

  return { start, stop };
}
