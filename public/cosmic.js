/**
 * Cosmic stage — starfield, mouse flare, occasional digital glitch.
 */

const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function burstGlitch(ms = 380) {
  if (reduceMotion()) return;
  document.body.classList.add('is-glitching');
  const brand = document.getElementById('portal-name');
  if (brand) {
    brand.dataset.text = brand.textContent?.trim() || '';
    brand.classList.add('glitch-text', 'is-glitching');
  }
  clearTimeout(burstGlitch._t);
  burstGlitch._t = setTimeout(() => {
    document.body.classList.remove('is-glitching');
    brand?.classList.remove('is-glitching');
  }, ms);
}

function initSpotlight() {
  const spot = document.getElementById('cosmic-spotlight');
  if (!spot || reduceMotion()) return;
  let raf = 0;
  let x = window.innerWidth / 2;
  let y = window.innerHeight * 0.2;
  const apply = () => {
    raf = 0;
    document.documentElement.style.setProperty('--spot-x', `${x}px`);
    document.documentElement.style.setProperty('--spot-y', `${y}px`);
  };
  window.addEventListener(
    'pointermove',
    (e) => {
      x = e.clientX;
      y = e.clientY;
      if (!raf) raf = requestAnimationFrame(apply);
    },
    { passive: true },
  );
}

function initStarfield() {
  const canvas = document.getElementById('cosmic-stars');
  if (!canvas || reduceMotion()) return;
  const ctx = canvas.getContext('2d', { alpha: true });
  if (!ctx) return;

  let stars = [];
  let w = 0;
  let h = 0;
  let running = true;

  const resize = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = window.innerWidth;
    h = window.innerHeight;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const count = Math.min(140, Math.floor((w * h) / 14000));
    stars = Array.from({ length: count }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      r: Math.random() * 1.4 + 0.2,
      a: Math.random(),
      s: Math.random() * 0.6 + 0.15,
      tw: Math.random() * Math.PI * 2,
    }));
  };

  let last = performance.now();
  const tick = (now) => {
    if (!running) return;
    const dt = Math.min(40, now - last) / 1000;
    last = now;
    ctx.clearRect(0, 0, w, h);
    for (const st of stars) {
      st.tw += dt * (0.8 + st.s);
      st.y -= dt * (6 + st.s * 18);
      if (st.y < -4) {
        st.y = h + 4;
        st.x = Math.random() * w;
      }
      const alpha = 0.25 + Math.abs(Math.sin(st.tw)) * 0.65;
      ctx.beginPath();
      ctx.fillStyle = st.r > 1.1
        ? `rgba(56, 189, 248, ${alpha})`
        : `rgba(248, 250, 252, ${alpha * 0.85})`;
      ctx.arc(st.x, st.y, st.r, 0, Math.PI * 2);
      ctx.fill();
    }
    requestAnimationFrame(tick);
  };

  resize();
  window.addEventListener('resize', resize, { passive: true });
  document.addEventListener('visibilitychange', () => {
    running = !document.hidden;
    if (running) {
      last = performance.now();
      requestAnimationFrame(tick);
    }
  });
  requestAnimationFrame(tick);
}

function syncBrandGlitch() {
  const brand = document.getElementById('portal-name');
  if (!brand) return;
  brand.classList.add('glitch-text');
  brand.dataset.text = brand.textContent?.trim() || 'ShadeRP';
  const obs = new MutationObserver(() => {
    brand.dataset.text = brand.textContent?.trim() || '';
  });
  obs.observe(brand, { childList: true, characterData: true, subtree: true });
}

export function initCosmic() {
  document.documentElement.style.setProperty('--spot-x', '50%');
  document.documentElement.style.setProperty('--spot-y', '18%');
  syncBrandGlitch();
  initSpotlight();
  initStarfield();
  if (!reduceMotion()) {
    setTimeout(() => burstGlitch(420), 900);
    setInterval(() => burstGlitch(320), 14000);
  }
}
