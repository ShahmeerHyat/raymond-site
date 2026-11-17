// Raymond, the mascot. A soft plush blob redrawn every frame: the outline wobbles, it breathes and bobs,
// blinks, follows the pointer with its eyes, squashes when poked, and changes face with its mood.
//   const r = Raymond.create(hostElement, { color: "raymond", shape: "pear", mood: "idle", fuzz: true, tie: true });
//   r.setMood("happy", 1500); r.poke(); r.lookAt(element);
(() => {
  const NS = "http://www.w3.org/2000/svg";
  const REDUCE = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const TAU = Math.PI * 2;

  const pointer = { x: 0, y: 0, moved: false, last: 0 };
  addEventListener("pointermove", e => {
    pointer.x = e.clientX; pointer.y = e.clientY; pointer.moved = true; pointer.last = performance.now();
  }, { passive: true });

  // light, base, shade
  const COLORS = {
    raymond:  ["#ffc09a", "#ff6a2b", "#b9370a"],
    reading:  ["#a9c8ff", "#3b7bff", "#1a3fb8"],
    thinking: ["#d2bdff", "#8b5cf6", "#4c1d95"],
    asking:   ["#ffe7a1", "#f5b324", "#a86808"],
    norecord: ["#a8eed6", "#25b886", "#0b6b4c"],
    waiting:  ["#ffb9d8", "#ff4f9a", "#a3124f"],
    brief:    ["#a6eef5", "#1fb5c6", "#0b6273"],
    flagged:  ["#ffb0a8", "#ef4444", "#8f1515"],
    ink:      ["#5a5a62", "#2a2a30", "#111114"],
  };

  // Outline personality: extra radius as a function of angle (0 = right, PI/2 = bottom).
  const SHAPES = {
    round:  () => 0,
    pear:   a => 0.06 * Math.sin(a) - 0.015 * Math.cos(2 * a),
    squircle: a => -0.055 * Math.cos(4 * a),
    bean:   a => 0.07 * Math.cos(2 * a) + 0.03 * Math.sin(a),
    clover: a => 0.075 * Math.cos(4 * a + Math.PI),
    drop:   a => 0.16 * Math.pow(Math.max(0, Math.cos(a + Math.PI / 2 + 0.55)), 4) - 0.02,
    tall:   a => -0.07 * Math.cos(2 * a),
  };

  const MOODS = {
    idle:     {},
    happy:    { eye: "happy", mouth: "smile" },
    reading:  { open: 0.72, scan: true, look: [0, 0.55] },
    thinking: { open: 0.95, look: [0.55, -0.8], extra: "dots" },
    asking:   { tilt: 7, brow: "raised", extra: "q" },
    norecord: { open: 0.85, look: [-0.75, 0.15], brow: "worried", mouth: "flat" },
    waiting:  { look: [0.05, 0.85], mouth: "o" },
    brief:    { eye: "line", extra: "z" },
    flagged:  { open: 0.55, brow: "angry", mouth: "flat", extra: "bang" },
  };

  // One shared plush filter: fuzzy edge plus a fine pale fleck.
  function ensureDefs() {
    if (document.getElementById("rfuzz")) return;
    const s = document.createElementNS(NS, "svg");
    s.setAttribute("width", "0"); s.setAttribute("height", "0"); s.setAttribute("aria-hidden", "true");
    s.style.position = "absolute";
    s.innerHTML = `
      <filter id="rfuzz" x="-15%" y="-15%" width="130%" height="130%" color-interpolation-filters="sRGB">
        <feTurbulence type="fractalNoise" baseFrequency="0.7" numOctaves="2" seed="4" result="n"/>
        <feDisplacementMap in="SourceGraphic" in2="n" scale="4" xChannelSelector="R" yChannelSelector="G" result="d"/>
        <feTurbulence type="fractalNoise" baseFrequency="1.3" numOctaves="2" seed="11" result="f"/>
        <feColorMatrix in="f" type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.9 -0.42" result="speck"/>
        <feGaussianBlur in="speck" stdDeviation="0.35" result="speck"/>
        <feComposite in="speck" in2="d" operator="in" result="fleck"/>
        <feMerge><feMergeNode in="d"/><feMergeNode in="fleck"/></feMerge>
      </filter>
      <filter id="rsoft" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="4"/></filter>`;
    document.body.prepend(s);
  }

  // Closed Catmull-Rom spline through the points, as cubic Beziers.
  function smoothPath(p) {
    const n = p.length;
    let d = `M${p[0][0].toFixed(2)} ${p[0][1].toFixed(2)}`;
    for (let i = 0; i < n; i++) {
      const p0 = p[(i - 1 + n) % n], p1 = p[i], p2 = p[(i + 1) % n], p3 = p[(i + 2) % n];
      d += `C${(p1[0] + (p2[0] - p0[0]) / 6).toFixed(2)} ${(p1[1] + (p2[1] - p0[1]) / 6).toFixed(2)} ` +
           `${(p2[0] - (p3[0] - p1[0]) / 6).toFixed(2)} ${(p2[1] - (p3[1] - p1[1]) / 6).toFixed(2)} ` +
           `${p2[0].toFixed(2)} ${p2[1].toFixed(2)}`;
    }
    return d + "Z";
  }

  const all = [];
  let uid = 0;

  class Ray {
    constructor(host, o = {}) {
      ensureDefs();
      this.host = host;
      this.id = ++uid;
      this.seed = o.seed ?? Math.random() * 100;
      this.shape = SHAPES[o.shape] || SHAPES.pear;
      this.stretch = o.stretch || [1.05, 0.97];
      this.fuzz = o.fuzz ?? true;
      this.tie = o.tie ?? false;
      this.wobble = REDUCE ? 0 : (o.wobble ?? 1);
      this.rest = o.mood || "idle";
      this.mood = this.rest;
      this.moodUntil = 0;
      this.look = [0, 0];
      this.target = null;
      this.squash = 0; this.squashV = 0;
      this.blinkAt = performance.now() + 1500 + Math.random() * 3000;
      this.blinkStart = -1;
      this.visible = true;
      this.build(o.color || "raymond");
      if (o.interactive !== false) {
        host.addEventListener("pointerdown", () => { this.poke(1); this.setMood("happy", 1100); });
        host.addEventListener("pointerenter", () => this.poke(0.35));
      }
      all.push(this);
      io.observe(host);
      this.draw(performance.now());
    }

    build(color) {
      const [l, b, s] = COLORS[color] || COLORS.raymond;
      const g = `rg${this.id}`;
      const svg = document.createElementNS(NS, "svg");
      svg.setAttribute("viewBox", "-20 -20 240 240");
      svg.setAttribute("aria-hidden", "true");
      svg.classList.add("ray-svg");
      svg.innerHTML = `
        <defs>
          <radialGradient id="${g}" cx="0.36" cy="0.28" r="0.85">
            <stop offset="0" stop-color="${l}"/><stop offset="0.5" stop-color="${b}"/><stop offset="1" stop-color="${s}"/>
          </radialGradient>
        </defs>
        <ellipse class="r-shadow" cx="100" cy="196" rx="54" ry="8" fill="#000" opacity=".5" filter="url(#rsoft)"/>
        <g class="r-bob">
          <g class="r-squash">
            <path class="r-body" fill="url(#${g})" ${this.fuzz ? 'filter="url(#rfuzz)"' : ""}/>
            <ellipse class="r-shine" cx="72" cy="62" rx="22" ry="11" fill="#fff" opacity=".2" transform="rotate(-28 72 62)" filter="url(#rsoft)"/>
            <g class="r-face">
              <path class="r-brow r-bl" d="M-7 0 L7 0" stroke="#17121a" stroke-width="4.5" stroke-linecap="round" fill="none"/>
              <path class="r-brow r-br" d="M-7 0 L7 0" stroke="#17121a" stroke-width="4.5" stroke-linecap="round" fill="none"/>
              <g class="r-eye r-el"><ellipse rx="7" ry="10.5" fill="#17121a"/><circle class="r-glint" cx="2.2" cy="-4" r="2.4" fill="#fff" opacity=".9"/>
                <path class="r-happy" d="M-8 3 Q0 -9 8 3" stroke="#17121a" stroke-width="5" stroke-linecap="round" fill="none"/>
                <path class="r-line" d="M-8 1 Q0 4 8 1" stroke="#17121a" stroke-width="4.5" stroke-linecap="round" fill="none"/></g>
              <g class="r-eye r-er"><ellipse rx="7" ry="10.5" fill="#17121a"/><circle class="r-glint" cx="2.2" cy="-4" r="2.4" fill="#fff" opacity=".9"/>
                <path class="r-happy" d="M-8 3 Q0 -9 8 3" stroke="#17121a" stroke-width="5" stroke-linecap="round" fill="none"/>
                <path class="r-line" d="M-8 1 Q0 4 8 1" stroke="#17121a" stroke-width="4.5" stroke-linecap="round" fill="none"/></g>
              <path class="r-mouth" stroke="#17121a" stroke-width="4" stroke-linecap="round" fill="none"/>
              <ellipse class="r-o" cx="0" cy="22" rx="3.6" ry="4.4" fill="#17121a"/>
            </g>
            <g class="r-tie">
              <path d="M-2 -2 Q-12 -10 -17 -6 Q-19 0 -17 6 Q-12 10 -2 2 Z M2 -2 Q12 -10 17 -6 Q19 0 17 6 Q12 10 2 2 Z" fill="#141317"/>
              <rect x="-4.5" y="-4.5" width="9" height="9" rx="3" fill="#232128"/>
              <path d="M-15 -4 Q-11 -6 -6 -2" stroke="#fff" stroke-opacity=".18" stroke-width="1.5" fill="none"/>
            </g>
            <g class="r-extra" font-family="Geist, system-ui, sans-serif" font-weight="700" fill="#fff">
              <text class="r-q" x="168" y="34" font-size="40">?</text>
              <text class="r-bang" x="166" y="38" font-size="42" fill="#ffd4d4">!</text>
              <g class="r-z"><text x="160" y="40" font-size="22" opacity=".9">z</text><text x="176" y="20" font-size="15" opacity=".6">z</text></g>
              <g class="r-dots"><circle cx="160" cy="34" r="5"/><circle cx="176" cy="22" r="6.5"/><circle cx="194" cy="6" r="8"/></g>
            </g>
          </g>
        </g>`;
      this.host.append(svg);
      const q = sel => svg.querySelector(sel);
      Object.assign(this, {
        svg, body: q(".r-body"), bob: q(".r-bob"), sq: q(".r-squash"), face: q(".r-face"), shadow: q(".r-shadow"),
        shine: q(".r-shine"), tieEl: q(".r-tie"), mouth: q(".r-mouth"), oMouth: q(".r-o"),
        eyes: [q(".r-el"), q(".r-er")], brows: [q(".r-bl"), q(".r-br")],
        xq: q(".r-q"), xbang: q(".r-bang"), xz: q(".r-z"), xdots: q(".r-dots"),
      });
      if (!this.tie) this.tieEl.style.display = "none";
    }

    setMood(m, ms) {
      if (ms) { this.mood = m; this.moodUntil = performance.now() + ms; }
      else { this.rest = m; this.mood = m; this.moodUntil = 0; }
    }
    poke(strength = 1) { this.squashV += 7 * strength; }
    gulp() { this.squashV -= 6; }
    lookAt(el) { this.target = el; }

    draw(now) {
      const t = now / 1000 + this.seed;
      if (this.moodUntil && now > this.moodUntil) { this.mood = this.rest; this.moodUntil = 0; }
      const M = MOODS[this.mood] || MOODS.idle;

      // spring squash
      const dt = Math.min(0.05, (now - (this.lastNow || now)) / 1000); this.lastNow = now;
      const acc = -170 * this.squash - 11 * this.squashV;
      this.squashV += acc * dt; this.squash += this.squashV * dt;
      const breathe = Math.sin(t * 1.8) * 0.014 * this.wobble;
      const sx = this.stretch[0] * (1 + 0.11 * this.squash - breathe);
      const sy = this.stretch[1] * (1 - 0.11 * this.squash + breathe);

      // outline
      const R = 72, cx = 100, cy = 104, n = 12, pts = [];
      let bottomY = cy;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU - Math.PI / 2;
        const wob = this.wobble * (0.035 * Math.sin(t * 1.25 + i * 1.9) + 0.022 * Math.sin(t * 2.3 + i * 3.1 + this.seed));
        const r = R * (1 + this.shape(a) + wob);
        const x = cx + Math.cos(a) * r * sx, y = cy + Math.sin(a) * r * sy;
        pts.push([x, y]);
        if (y > bottomY) bottomY = y;
      }
      this.body.setAttribute("d", smoothPath(pts));
      const bob = Math.sin(t * 1.6) * 4 * this.wobble;
      this.bob.setAttribute("transform", `translate(0 ${bob.toFixed(2)})`);
      this.shadow.setAttribute("rx", (54 * sx - bob * 0.8).toFixed(2));
      this.shadow.setAttribute("opacity", (0.5 - bob * 0.02).toFixed(3));

      // gaze
      let tx, ty;
      if (M.look) {
        [tx, ty] = M.look;
        if (M.scan) tx = Math.sin(t * 2.6) * 0.6;
      } else {
        const r = this.svg.getBoundingClientRect();
        const ox = r.left + r.width / 2, oy = r.top + r.height * 0.45;
        let px, py;
        if (this.target) { const b = this.target.getBoundingClientRect(); px = b.left + b.width / 2; py = b.top + b.height / 2; }
        else if (pointer.moved && now - pointer.last < 6000) { px = pointer.x; py = pointer.y; }
        if (px === undefined) { tx = Math.sin(t * 0.45) * 0.5; ty = Math.sin(t * 0.7) * 0.25 + 0.1; }
        else {
          const dx = px - ox, dy = py - oy, dist = Math.hypot(dx, dy) || 1, k = Math.min(1, dist / 260);
          tx = (dx / dist) * k; ty = (dy / dist) * k;
        }
      }
      const ease = Math.min(1, dt * 7);
      this.look[0] += (tx - this.look[0]) * ease; this.look[1] += (ty - this.look[1]) * ease;
      const [lx, ly] = this.look;

      // blink
      let open = M.open ?? 1;
      if (now > this.blinkAt && this.blinkStart < 0) this.blinkStart = now;
      if (this.blinkStart >= 0) {
        const p = (now - this.blinkStart) / 170;
        if (p >= 1) { this.blinkStart = -1; this.blinkAt = now + (Math.random() < 0.2 ? 220 : 2200 + Math.random() * 4200); }
        else open *= 1 - Math.sin(p * Math.PI) * 0.92;
      }

      const tilt = (M.tilt || 0) + lx * 4;
      const fy = cy - 4 + ly * 7;
      this.face.setAttribute("transform", `translate(${(cx + lx * 9).toFixed(2)} ${fy.toFixed(2)}) rotate(${tilt.toFixed(2)})`);
      const eyeKind = M.eye || "oval";
      this.eyes.forEach((e, i) => {
        const side = i ? 1 : -1;
        const ex = side * 19 + lx * 3.5, ey = ly * 3;
        let s = 1;
        if (M.brow === "raised" && i === 1) s = 1.12;
        e.setAttribute("transform", `translate(${ex.toFixed(2)} ${ey.toFixed(2)}) scale(${s} ${eyeKind === "oval" ? Math.max(0.06, open) * s : s})`);
        e.children[0].style.display = e.children[1].style.display = eyeKind === "oval" ? "" : "none";
        e.querySelector(".r-happy").style.display = eyeKind === "happy" ? "" : "none";
        e.querySelector(".r-line").style.display = eyeKind === "line" ? "" : "none";
      });
      // brows
      const browDefs = {
        raised:  [null, [0, -26, -10]],
        worried: [[0, -19, -14], [0, -19, 14]],
        angry:   [[0, -15, 20], [0, -15, -20]],
      }[M.brow] || [null, null];
      this.brows.forEach((b, i) => {
        const d = browDefs[i];
        if (!d) { b.style.display = "none"; return; }
        b.style.display = "";
        const side = i ? 1 : -1;
        b.setAttribute("transform", `translate(${(side * 19 + lx * 3.5).toFixed(2)} ${(d[1] + ly * 3).toFixed(2)}) rotate(${d[2]})`);
      });
      // mouth
      const mouthD = { smile: "M-7 18 Q0 25 7 18", flat: "M-5 21 L5 21" }[M.mouth];
      this.mouth.style.display = mouthD ? "" : "none";
      if (mouthD) this.mouth.setAttribute("d", mouthD);
      this.oMouth.style.display = M.mouth === "o" ? "" : "none";

      // tie sits on the lower edge and follows the gaze a little
      if (this.tie) this.tieEl.setAttribute("transform",
        `translate(${(cx + lx * 5).toFixed(2)} ${(bottomY - 17).toFixed(2)}) rotate(${(lx * 6 + this.squashV * 0.6).toFixed(2)})`);

      // extras
      const show = (el, on) => { el.style.display = on ? "" : "none"; };
      show(this.xq, M.extra === "q"); show(this.xbang, M.extra === "bang");
      show(this.xz, M.extra === "z"); show(this.xdots, M.extra === "dots");
      if (M.extra === "z") this.xz.setAttribute("transform", `translate(0 ${((t * 8) % 10).toFixed(2)})`);
      if (M.extra === "dots") [...this.xdots.children].forEach((c, i) => c.setAttribute("opacity", (0.35 + 0.65 * Math.max(0, Math.sin(t * 4 - i * 0.9))).toFixed(2)));
      if (M.extra === "q" || M.extra === "bang") (M.extra === "q" ? this.xq : this.xbang).setAttribute("transform", `translate(0 ${(Math.sin(t * 3) * 3).toFixed(2)})`);
    }
  }

  const io = new IntersectionObserver(es => {
    for (const e of es) { const r = all.find(x => x.host === e.target); if (r) r.visible = e.isIntersecting; }
  }, { rootMargin: "80px" });

  function frame(now) {
    for (const r of all) if (r.visible) r.draw(now);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  window.Raymond = { create: (host, o) => new Ray(host, o), all, COLORS, MOODS, reduce: REDUCE };
})();
