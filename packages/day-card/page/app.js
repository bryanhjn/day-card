// The page: reads usage:day (the only read package.json declares) for the
// day picked, or the week, month or all time ending on it, draws it on a canvas as a receipt, and hands that canvas's
// PNG to magpie.image to copy or save.
(async () => {
  const V = globalThis.DayView;
  const B = globalThis.DayBackgrounds;
  const $ = (id) => document.getElementById(id);
  const theme = await magpie.ready;
  let lang = theme.lang;
  const zone = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch { return ""; } })();
  const state = { date: "", span: "day", by: "agent", day: null, icons: new Map(), loading: 0, drawn: 0, bg: B.norm(null) };

  // ---- words ----
  function words() {
    const t = V.text(lang);
    document.querySelectorAll("[data-t]").forEach((e) => { e.textContent = t[e.dataset.t]; });
    document.querySelectorAll("[data-t-label]").forEach((e) => { e.setAttribute("aria-label", t[e.dataset.tLabel]); e.title = t[e.dataset.tLabel]; });
  }
  let statusTimer = 0;
  function status(msg, bad, keep) {
    clearTimeout(statusTimer);
    $("status").textContent = msg || "";
    $("status").classList.toggle("bad", !!bad);
    if (msg && !keep) statusTimer = setTimeout(() => status(""), 6000);
  }

  // ---- the receipt's look: fixed, as a printed slip is, in either theme ----
  const INK = "#1f1d20";
  const MUTED = "#76736e";
  const PAPER = "#f7f4ed";
  const MONO = '"Day Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, "PingFang SC", "Hiragino Sans", "Microsoft YaHei", "Noto Sans CJK SC", monospace';

  // The slip's finish, kept in one place to be tuned: the paper's shadow on
  // the backdrop, the shade the title and the total carry, the rules between
  // sections, and the grain of the paper. All of it quiet: a printed slip on
  // a table, not a glowing card.
  const LOOK = {
    paper: { blur: 26, offsetY: 8, alpha: 0.55 },
    ink: { colour: "rgba(31, 29, 32, .1)", blur: 4, offsetY: 1 },
    rule: { colour: "rgba(168, 164, 156, .55)", width: 0.9, dash: [4, 4], inset: 11 },
    grain: { alpha: 0.55, tile: 72 },
    // a fold is lit on one side and shaded on the other. Most of its weight is
    // in the light: paper catches the light where it bends, while a heavy shade
    // is what would read as grime, so the shade stays soft and under it.
    crease: { light: 0.09, dark: 0.062 },
    // the head that printed it: a slip comes off a thermal head, and the head
    // is never even. Its feed leaves lines across the slip, some of its
    // elements run cooler than their neighbours, the coating takes the heat in
    // patches, it stalls for a line now and then, and where the type is
    // heaviest it starves. Every fault leaves ink off, so the paper shows
    // through. A fault's depth is the least and most of the ink it may take.
    press: {
      bands: 0.07, // the head's feed lines, a hair apart
      bandGap: 3.2,
      bandThick: 0.5,
      columns: { count: 6, depth: [0.12, 0.34], width: [1.5, 5] },
      patches: { count: 6, depth: [0.1, 0.26], radius: [70, 180] },
      stalls: { count: 3, depth: [0.14, 0.3], thick: [0.6, 1.2] },
      starve: { depth: 0.22 }, // the heaviest type: a row it stalled on
      mottle: { count: 16, radius: [3, 11], depth: [0.14, 0.46] },
      breaks: 14,
      hold: 0.78, // how much of its ink a cold element leaves off
      grain: 0.34, // the grain at the type's edges
      pinhole: 0.55, // the noise above which an element starved a point
    },
  };

  // JetBrains Mono from fonts.js's bytes: no fetch, which the frame can't make
  const fonts = (async () => {
    const F = globalThis.DayFonts || {};
    await Promise.all(Object.entries(F).map(async ([weight, b64]) => {
      try {
        const bin = atob(b64);
        const buf = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
        const face = new FontFace("Day Mono", buf.buffer, { weight });
        document.fonts.add(await face.load());
      } catch {
        // the system's monospace draws it instead
      }
    }));
  })();

  // ---- logos: data: pictures from the read, each drawn in the ink ----
  function picture(name) {
    const ic = globalThis.DayIcons?.[name] || state.day?.icons?.[name];
    if (!ic?.src) return Promise.resolve(null);
    if (!state.icons.has(ic.src)) {
      state.icons.set(ic.src, new Promise((ok) => {
        const img = new Image();
        img.onload = () => ok({ img, mono: !!ic.mono });
        img.onerror = () => ok(null);
        img.src = ic.src;
      }));
    }
    return state.icons.get(ic.src);
  }
  // A mark (a mono logo, or a colour one with no ground of its own) is
  // filled with the ink; a picture on a light ground of its own (an app's
  // tile, a drawing) prints in the ink, only its near-white parts left the
  // paper's, and what is clear around it stays clear. A tile with no light
  // ground (an app icon, an illustration like Cindy's) prints in greys from
  // its own darkest to its lightest, so it doesn't fill in as a block.
  function drawIcon(ctx, ic, x, y, size, scale) {
    if (!ic) {
      ctx.fillStyle = INK;
      ctx.beginPath();
      ctx.arc(x + size / 2, y + size / 2, size * 0.22, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    const px = Math.max(1, Math.ceil(size * scale));
    const off = document.createElement("canvas");
    off.width = off.height = px;
    const o = off.getContext("2d");
    const ratio = Math.min(px / ic.img.naturalWidth, px / ic.img.naturalHeight);
    const w = ic.img.naturalWidth * ratio, h = ic.img.naturalHeight * ratio;
    o.drawImage(ic.img, (px - w) / 2, (px - h) / 2, w, h);
    let clear = ic.mono;
    if (!clear) {
      try {
        const d = o.getImageData(0, 0, px, px);
        const p = d.data;
        const lum = (i) => (0.2126 * p[i] + 0.7152 * p[i + 1] + 0.0722 * p[i + 2]) / 255;
        let solid = 0, light = 0, dark = 0;
        let x0 = px, y0 = px, x1 = -1, y1 = -1;
        const tones = [];
        for (let i = 0; i < p.length; i += 4) {
          if (p[i + 3] < 128) continue;
          solid++;
          const v = lum(i);
          tones.push(v);
          if (v > 0.8) light++;
          else if (v < 0.5) dark++;
          const cx = (i / 4) % px, cy = Math.floor(i / 4 / px);
          if (cx < x0) x0 = cx;
          if (cx > x1) x1 = cx;
          if (cy < y0) y0 = cy;
          if (cy > y1) y1 = cy;
        }
        // a ground: mostly light, with something dark drawn on it
        const ground = solid && light / solid > 0.35 && dark / solid > 0.05;
        // a tile: it fills its own box (a square, rounded or not, or a disc), and the
        // box is most of the icon
        const box = (x1 - x0 + 1) * (y1 - y0 + 1);
        const tile = solid >= px * px * 0.8 || (x1 >= 0 && solid >= box * 0.75 && box >= px * px * 0.4);
        clear = !ground && !tile;
        if (!clear) {
          const ink = [0x1f, 0x1d, 0x20], paper = [0xf7, 0xf4, 0xed];
          let tone = null;
          if (!ground) {
            tones.sort((a, b) => a - b);
            const lo = tones[Math.floor(tones.length * 0.03)];
            const hi = tones[Math.min(tones.length - 1, Math.floor(tones.length * 0.97))];
            if (hi - lo > 0.12) tone = (v) => Math.min(1, Math.max(0, (v - lo) / (hi - lo)));
          }
          for (let i = 0; i < p.length; i += 4) {
            let l;
            if (tone) l = tone(lum(i));
            else {
              // only what is near white stays light: a logo prints solid
              const t = Math.min(1, Math.max(0, (lum(i) - 0.65) / 0.2));
              l = t * t * (3 - 2 * t);
            }
            for (let k = 0; k < 3; k++) p[i + k] = ink[k] + (paper[k] - ink[k]) * l;
          }
          o.putImageData(d, 0, 0);
        }
      } catch {
        clear = true;
      }
    }
    if (clear) {
      o.globalCompositeOperation = "source-in";
      o.fillStyle = INK;
      o.fillRect(0, 0, px, px);
    }
    ctx.drawImage(off, x, y, size, size);
  }

  // ---- the receipt ----
  const PW = 440; // the paper
  const PAD = 30; // the paper's margin; the backdrop's is the reader's (state.bg.pad)
  const TOOTH = 4; // the torn edge's teeth: shallow, a slip parted from its roll
  const TOOTH_PITCH = 10; // their width: a longer, gentler saw than a deep one

  const f = (w, px) => `${w} ${px}px ${MONO}`;
  // a backdrop's shadow, softened: the paper sits on the ground rather than
  // hovering over it, so the shade keeps the ground's hue and loses some of
  // its weight
  function fade(colour, k) {
    const m = /^rgba?\(([^)]+)\)$/i.exec(String(colour));
    if (!m) return colour;
    const p = m[1].split(",").map((v) => parseFloat(v));
    if (p.length < 3) return colour;
    const a = (p.length > 3 ? p[3] : 1) * k;
    return `rgba(${Math.round(p[0])}, ${Math.round(p[1])}, ${Math.round(p[2])}, ${Math.round(a * 1000) / 1000})`;
  }
  function fit(ctx, s, width) {
    if (ctx.measureText(s).width <= width) return s;
    let lo = 0, hi = s.length;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (ctx.measureText(s.slice(0, mid) + "…").width <= width) lo = mid; else hi = mid - 1;
    }
    return s.slice(0, lo) + "…";
  }
  // text with its letters spaced, centred on cx
  function spaced(ctx, s, cx, y, em, max) {
    const chars = [...s];
    const bare = chars.reduce((n, ch) => n + ctx.measureText(ch).width, 0);
    const gap = Math.max(0, Math.min(em, (max - bare) / Math.max(1, chars.length - 1)));
    const w = bare + gap * (chars.length - 1);
    let x = cx - w / 2;
    ctx.textAlign = "left";
    for (const ch of chars) {
      ctx.fillText(ch, x, y);
      x += ctx.measureText(ch).width + gap;
    }
  }
  // text whose words sit closer than a space, centred on cx
  function tight(ctx, s, cx, y) {
    const parts = s.split(" ");
    const gap = ctx.measureText(" ").width * 0.45;
    const ws = parts.map((p) => ctx.measureText(p).width);
    let x = cx - (ws.reduce((n, w) => n + w, 0) + gap * (parts.length - 1)) / 2;
    ctx.textAlign = "left";
    parts.forEach((p, i) => {
      ctx.fillText(p, x, y);
      x += ws[i] + gap;
    });
  }
  // the largest size up to px that keeps s within width
  function sized(ctx, weight, px, s, width) {
    ctx.font = f(weight, px);
    const w = ctx.measureText(s).width;
    if (w > width) {
      px = Math.max(10, Math.floor(px * width / w));
      ctx.font = f(weight, px);
    }
    return px;
  }

  // The slip's text, top to bottom, on the paper at (0, 0): the height it
  // took, and where its heaviest type sits, which the head's wear wears most.
  // Run once on a scratch canvas to measure, then on the ink's own sheet.
  function slip(ctx, c, icons, scale) {
    const L = PAD, R = PW - PAD, inner = R - L;
    // where the heaviest type sits: the head wears it most (press)
    const heavy = [];
    const heavyAt = (s, cx, y, px) => {
      const w = Math.min(inner, ctx.measureText(s).width);
      heavy.push({ x: cx - w / 2, y: y - px * 0.84, w, h: px * 1.02 });
    };
    const rule = (y) => {
      ctx.save();
      ctx.strokeStyle = LOOK.rule.colour;
      ctx.lineWidth = LOOK.rule.width;
      ctx.setLineDash(LOOK.rule.dash);
      ctx.beginPath();
      ctx.moveTo(L + LOOK.rule.inset, y + 0.5);
      ctx.lineTo(R - LOOK.rule.inset, y + 0.5);
      ctx.stroke();
      ctx.restore();
    };
    // a number: right-aligned on the column, on the text baseline, so every
    // amount in a section ends on the same edge and sits on the same line.
    // Day Mono's digits are all one width, so a column of amounts is even.
    const amount = (s, y, weight, px) => {
      ctx.textBaseline = "alphabetic";
      ctx.font = f(weight, px);
      ctx.textAlign = "right";
      ctx.fillText(s, R, y);
      return ctx.measureText(s).width;
    };
    const row = (label, value, y, o = {}) => {
      ctx.fillStyle = o.colour || INK;
      const vw = amount(value, y, o.weight || 400, o.px || 12.5);
      ctx.font = f(o.weight || 400, o.px || 12.5);
      ctx.textAlign = "left";
      ctx.fillText(fit(ctx, label, inner - vw - 14), L, y);
    };
    // the title and the total: a whisper of shade, enough to lift the ink
    // from the paper without blurring its edge
    const glow = (on) => {
      const s = LOOK.ink;
      ctx.shadowColor = on ? s.colour : "transparent";
      ctx.shadowBlur = on ? s.blur : 0;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = on ? s.offsetY : 0;
    };
    ctx.textBaseline = "alphabetic";
    let y = 0;

    // title
    y += 54;
    ctx.fillStyle = INK;
    const titlePx = sized(ctx, 800, 30, c.title, inner);
    glow(true);
    tight(ctx, c.title, PW / 2, y);
    glow(false);
    heavyAt(c.title, PW / 2, y, titlePx);

    // the day, and when this was drawn
    y += 34;
    c.head.forEach((h, i) => {
      if (i) y += 22;
      row(h.label, h.value, y);
    });
    y += 15;
    rule(y);

    // the day's cost
    y += 25;
    ctx.fillStyle = INK;
    ctx.font = f(400, 12.5);
    spaced(ctx, c.totalLabel, PW / 2, y, 3.2, inner);
    y += 57;
    const totalPx = sized(ctx, 800, 52, c.total, inner);
    ctx.textAlign = "center";
    glow(true);
    ctx.fillText(c.total, PW / 2, y);
    glow(false);
    heavyAt(c.total, PW / 2, y, totalPx);
    y += 23;
    sized(ctx, 400, 10.5, c.totalNote, inner);
    spaced(ctx, c.totalNote, PW / 2, y, 1.6, inner);
    y += 16;
    rule(y);

    // the tokens, right under the cost
    y += 25;
    c.tokens.forEach((s, i) => {
      if (i) y += 21;
      row(s.label, s.value, y);
    });
    if (c.note) {
      y += 21;
      row(c.note, "", y, { colour: MUTED, px: 11 });
    }
    y += 18;
    rule(y);

    // each agent and its models, by cost, with the tokens beside the cost
    y += 25;
    // TOKEN is a column of its own just left of COST: the widest amount sets
    // how much room it takes, so both columns line up down the section
    const weightOf = c.by === "model" ? 400 : 700;
    const pxOf = c.by === "model" ? 12.5 : 14.5;
    const widthOf = (s, weight, px) => { ctx.font = f(weight, px); return ctx.measureText(s).width; };
    let costW = widthOf(c.agentHead[2], 400, 12.5);
    for (const a of c.agents) {
      costW = Math.max(costW, widthOf(a.value, weightOf, pxOf));
      for (const m of a.models) costW = Math.max(costW, widthOf(m.value, 400, 12.5));
    }
    const tokenX = R - costW - 20;
    // count()'s 万 and 亿 are not Day Mono's: the fallback face draws them a
    // full em tall where the digits are barely half of one, so at the same
    // size they read bigger than the cost. The unit is set a little smaller,
    // and lifted, to sit level with the number it ends.
    const UNIT = /([万亿])$/;
    const UNIT_SIZE = 0.8;
    const UNIT_RISE = 0.12;
    const tokenWidth = (s, px) => {
      const u = UNIT.exec(s);
      ctx.font = f(400, px);
      let w = ctx.measureText(u ? s.slice(0, -1) : s).width;
      if (u) {
        ctx.font = f(400, px * UNIT_SIZE);
        w += ctx.measureText(u[1]).width;
      }
      return w;
    };
    // the lift is tuned on an agent's bold digits; against regular ones the
    // same lift reads a little high, so they take most of it, not all
    const tokenText = (s, right, px, bold) => {
      const u = UNIT.exec(s);
      const num = u ? s.slice(0, -1) : s;
      const x = right - tokenWidth(s, px);
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
      ctx.font = f(400, px);
      ctx.fillText(num, x, y);
      if (u) {
        const nw = ctx.measureText(num).width;
        ctx.font = f(400, px * UNIT_SIZE);
        ctx.fillText(u[1], x + nw, y - px * UNIT_RISE * (bold ? 1 : 0.72));
      }
    };
    // a row's two numbers, and its name between the icons and them
    const entry = (ic, ix, iy, size, name, tokens, value, weight, px, tx) => {
      drawIcon(ctx, icons.get(ic), ix, iy, size, scale);
      ctx.fillStyle = INK;
      amount(value, y, weight, px);
      // the tokens are the cost's own size, on the same baseline
      tokenText(tokens, tokenX, px, weight >= 700);
      const tw = tokenWidth(tokens, px);
      ctx.font = f(weight, px);
      ctx.textAlign = "left";
      ctx.fillText(fit(ctx, name, tokenX - tw - 14 - tx), tx, y);
    };
    ctx.fillStyle = MUTED;
    ctx.font = f(400, 12.5);
    ctx.textAlign = "right";
    ctx.fillText(c.agentHead[2], R, y);
    const headTokens = widthOf(c.agentHead[1], 400, 12.5);
    ctx.fillText(c.agentHead[1], tokenX, y);
    ctx.textAlign = "left";
    ctx.fillText(fit(ctx, c.agentHead[0], tokenX - headTokens - 14 - L), L, y);
    if (c.empty) {
      y += 27;
      ctx.font = f(400, 12.5);
      ctx.fillStyle = MUTED;
      ctx.textAlign = "left";
      ctx.fillText(c.empty, L, y);
    }
    for (const a of c.agents) {
      y += 27;
      // grouped by model there is no tree: each row is a model, drawn as the
      // models under an agent are, not as an agent's own line
      if (c.by === "model") {
        entry(a.icon, L + 3, y - 12, 14, a.name, a.tokens, a.value, 400, 12.5, L + 22);
        continue;
      }
      entry(a.icon, L, y - 15, 18, a.name, a.tokens, a.value, 700, 14.5, L + 26);
      y += 1;
      for (const m of a.models) {
        y += 27;
        entry(m.icon, L + 26, y - 10.5, 12, m.name, m.tokens, m.value, 400, 12.5, L + 44);
      }
      if (a.more) {
        y += 24;
        ctx.font = f(400, 11.5);
        ctx.fillStyle = MUTED;
        ctx.textAlign = "left";
        ctx.fillText(a.more, L + 44, y);
      }
      y += 3;
    }
    if (c.moreAgents) {
      y += 24;
      ctx.font = f(400, 11.5);
      ctx.fillStyle = MUTED;
      ctx.textAlign = "left";
      ctx.fillText(c.moreAgents, L + 26, y);
    }
    y += 17;
    rule(y);

    // streak, requests, against an average day
    y += 25;
    c.stats.forEach((s, i) => {
      if (i) y += 21;
      row(s.label, s.value, y);
    });
    y += 15;
    rule(y);

    // whose design the receipt follows
    if (c.credit) {
      y += 22;
      ctx.font = f(400, 9.5);
      ctx.fillStyle = MUTED;
      ctx.textAlign = "center";
      ctx.fillText(c.credit, PW / 2, y);
      y += 18;
    }
    return { h: Math.ceil(y + 4), heavy };
  }

  // The head's own faults, over the ink alone: a slip comes off a thermal
  // head, and the head is never even. Its feed leaves lines across the slip,
  // some of its elements run cooler than their neighbours, the coating takes
  // the heat in patches, it stalls for a line now and then, and where the type
  // is heaviest — the title, the total — it starves, so their middles print
  // mottled and their strokes come out in places. The slip's ink is drawn on a
  // sheet of its own and worn here, so a fault leaves the paper bare and never
  // touches the paper's grain or its folds. Seeded, so every redraw is the same
  // slip; quiet enough that the slip still reads first.
  function press(ink, w, h, heavy, scale) {
    const p = LOOK.press;
    const px = Math.max(1, Math.round(w * scale)), py = Math.max(1, Math.round(h * scale));

    // the faults a thermal head has always, and this slip's own: base() is kept
    // and drawn from, never written to, so a redraw starts from the same wear
    const mask = document.createElement("canvas");
    mask.width = px;
    mask.height = py;
    const g = mask.getContext("2d");
    g.drawImage(base(w, h, scale), 0, 0);
    g.setTransform(scale, 0, 0, scale, 0, 0);

    let seed = 0x6b43a9d1;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
    const between = ([lo, hi]) => lo + rnd() * (hi - lo);
    const black = (a) => `rgba(0, 0, 0, ${Math.max(0, Math.min(1, a))})`;

    // where the type is heaviest the head starves. Its middles print mottled:
    // soft pale blotches, the size of a few elements, laid over the strokes.
    for (const b of heavy) {
      for (let i = 0, n = p.mottle.count; i < n; i++) {
        const cx = b.x + rnd() * b.w, cy = b.y + rnd() * b.h;
        const r = between(p.mottle.radius);
        const a = between(p.mottle.depth);
        const rad = g.createRadialGradient(cx, cy, 0, cx, cy, r);
        rad.addColorStop(0, black(a));
        rad.addColorStop(0.55, black(a * 0.45));
        rad.addColorStop(1, black(0));
        g.fillStyle = rad;
        g.fillRect(cx - r, cy - r, r * 2, r * 2);
      }
      // its strokes come out in places: short pale runs along a row, not all
      // at once, so a break reads as a starved element rather than a crack
      for (let i = 0, n = p.breaks; i < n; i++) {
        const y = b.y + rnd() * b.h;
        const x = b.x + rnd() * b.w;
        g.fillStyle = black(between([0.25, 0.6]));
        g.fillRect(x, y, 3 + rnd() * 22, 0.3 + rnd() * 0.5);
      }
      // a row the head stalled on, faint, right across it
      if (rnd() < 0.85) {
        const y = b.y + b.h * (0.25 + rnd() * 0.5);
        const grad = g.createLinearGradient(b.x, 0, b.x + b.w, 0);
        grad.addColorStop(0, black(0));
        grad.addColorStop(0.18, black(p.starve.depth * 0.75));
        grad.addColorStop(0.82, black(p.starve.depth * 0.75));
        grad.addColorStop(1, black(0));
        g.fillStyle = grad;
        g.fillRect(b.x, y, b.w, 0.5 + rnd() * 0.7);
      }
      // and a column of theirs that ran cool, as wide as a stroke
      const cx = b.x + b.w * (0.12 + rnd() * 0.76);
      const wide = 0.5 + rnd() * 1.4;
      const col = g.createLinearGradient(cx - wide, 0, cx + wide, 0);
      col.addColorStop(0, black(0));
      col.addColorStop(0.5, black(between([0.14, 0.3])));
      col.addColorStop(1, black(0));
      g.fillStyle = col;
      g.fillRect(cx - wide, b.y, wide * 2, b.h);
    }

    // the ink and the wear, pixel by pixel: the head's density takes the ink
    // down, and a little grain breaks the type's edges, where a thermal
    // element either fired or did not. A solid stroke keeps most of its
    // density; an antialiased edge is where the grain shows, and the odd point
    // of the heaviest type comes out bare, the element starved there.
    const art = ink.getImageData(0, 0, px, py);
    const wear = mask.getContext("2d").getImageData(0, 0, px, py);
    const a = art.data, m = wear.data;
    const noise = inkGrain(px, py, scale);
    for (let y = 0, i = 0, n = 0; y < py; y++) {
      for (let x = 0; x < px; x++, i += 4) {
        const alpha = a[i + 3];
        if (!alpha) { n++; continue; }
        // the head's density here: 0 is a good element, 1 a cold one
        const density = 1 - (m[i + 3] / 255) * p.hold;
        const t = alpha / 255;
        // solid ink keeps its density; a soft edge is where grain shows
        const edge = 0.45 + 0.55 * (1 - t);
        let v = alpha * density + noise[n] * 255 * edge * p.grain;
        // a starved point: the element left the paper bare, and the bolder the
        // type the likelier it is, as a heavy stroke needs more of its heat
        if (noise[n] > p.pinhole && t > 0.55) v *= 0.12;
        n++;
        a[i + 3] = Math.max(0, Math.min(255, Math.round(v)));
      }
    }
    ink.putImageData(art, 0, 0);
  }

  // The ink's grain, one value a pixel: fine, and in patches, as the coating
  // takes the heat, and long along the row where a thermal element's heat is
  // even along its width and uneven from row to row. Built once per size and
  // kept; seeded, so every redraw is the same slip.
  const inkGrains = new Map();
  function inkGrain(px, py, scale) {
    const key = `${px}x${py}`;
    if (inkGrains.has(key)) return inkGrains.get(key);
    // a number from two coordinates, the same every time
    const hash = (x, y) => {
      let v = Math.imul(x + 1, 374761393) + Math.imul(y + 1, 668265263);
      v = Math.imul(v ^ (v >>> 13), 1274126177);
      return ((v ^ (v >>> 16)) >>> 0) / 4294967296;
    };
    // smooth noise, bilinear over a lattice of stepX by stepY pixels
    const lattice = (x, y, stepX, stepY) => {
      const fx = x / stepX, fy = y / stepY;
      const ix = Math.floor(fx), iy = Math.floor(fy);
      const tx = fx - ix, ty = fy - iy;
      const v = (i, j) => hash(i, j);
      const top = v(ix, iy) + (v(ix + 1, iy) - v(ix, iy)) * tx;
      const bot = v(ix, iy + 1) + (v(ix + 1, iy + 1) - v(ix, iy + 1)) * tx;
      return top + (bot - top) * ty;
    };
    const fine = Math.max(2, Math.round(scale * 1.4));
    const row = Math.max(2, Math.round(scale * 6));
    const out = new Float32Array(px * py);
    for (let y = 0, n = 0; y < py; y++) {
      for (let x = 0; x < px; x++) {
        out[n++] = (hash(x, y) - 0.5) * 0.4
          + (lattice(x, y, fine, fine) - 0.5) * 0.4
          + (lattice(x, y, fine, row) - 0.5) * 0.6;
      }
    }
    inkGrains.set(key, out);
    return out;
  }

  // the head's even faults, drawn once for a slip of this size and kept: its
  // feed lines, the elements that run cooler than their neighbours, the
  // coating's patches, and the lines it stalled on. Seeded, so every redraw is
  // the same slip.
  const bases = new Map();
  function base(w, h, scale) {
    const key = `${w}x${h}x${scale}`;
    if (bases.has(key)) return bases.get(key);
    const p = LOOK.press;
    const cv = document.createElement("canvas");
    cv.width = Math.max(1, Math.round(w * scale));
    cv.height = Math.max(1, Math.round(h * scale));
    const g = cv.getContext("2d");
    g.setTransform(scale, 0, 0, scale, 0, 0);
    let seed = 0x2545f491;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
    const between = ([lo, hi]) => lo + rnd() * (hi - lo);
    const black = (a) => `rgba(0, 0, 0, ${Math.max(0, Math.min(1, a))})`;

    // the head's feed: its lines, a hair apart, a shade pale
    g.fillStyle = black(p.bands);
    for (let y = 0; y < h; y += p.bandGap) g.fillRect(0, y, w, p.bandThick);

    // a stall: a line of the head that came out pale, across part of the slip,
    // recovering at both ends
    for (let i = 0, n = p.stalls.count; i < n; i++) {
      const y = 20 + rnd() * Math.max(1, h - 40);
      const from = rnd() * w * 0.5;
      const to = Math.min(w, from + w * (0.3 + rnd() * 0.6));
      const a = between(p.stalls.depth);
      const grad = g.createLinearGradient(from, 0, to, 0);
      grad.addColorStop(0, black(0));
      grad.addColorStop(0.18, black(a));
      grad.addColorStop(0.82, black(a));
      grad.addColorStop(1, black(0));
      g.fillStyle = grad;
      g.fillRect(from, y, to - from, between(p.stalls.thick));
    }

    // an element cooler than the rest: a pale column down the whole slip
    for (let i = 0, n = p.columns.count; i < n; i++) {
      const cx = rnd() * w;
      const wide = between(p.columns.width);
      const a = between(p.columns.depth);
      const grad = g.createLinearGradient(cx - wide, 0, cx + wide, 0);
      grad.addColorStop(0, black(0));
      grad.addColorStop(0.5, black(a));
      grad.addColorStop(1, black(0));
      g.fillStyle = grad;
      g.fillRect(cx - wide, 0, wide * 2, h);
    }

    // the coating: broad patches that take the heat less, soft at their edges
    for (let i = 0, n = p.patches.count; i < n; i++) {
      const cx = rnd() * w, cy = rnd() * h;
      const r = between(p.patches.radius);
      const a = between(p.patches.depth);
      g.save();
      g.translate(cx, cy);
      g.rotate(rnd() * Math.PI);
      g.scale(0.7 + rnd() * 0.7, 1);
      const rad = g.createRadialGradient(0, 0, 0, 0, 0, r);
      rad.addColorStop(0, black(a));
      rad.addColorStop(0.55, black(a * 0.35));
      rad.addColorStop(1, black(0));
      g.fillStyle = rad;
      g.beginPath();
      g.arc(0, 0, r, 0, Math.PI * 2);
      g.fill();
      g.restore();
    }

    // the slip's right edge runs a shade pale, where the head is coldest
    const edge = g.createLinearGradient(w * 0.86, 0, w, 0);
    edge.addColorStop(0, black(0));
    edge.addColorStop(1, black(0.1));
    g.fillStyle = edge;
    g.fillRect(w * 0.86, 0, w * 0.14, h);

    bases.set(key, cv);
    return cv;
  }

  // the paper's creases: a slip is folded to fit a pocket, and the folds stay
  // in it. Each is a soft band with a lit side and a shaded one, laid under
  // the ink, so the print still reads first.
  function creases(ctx, w, h) {
    const c = LOOK.crease;
    // the paper is not quite flat: one long, faint shade across it, so the
    // light seems to fall on a sheet rather than a plane
    const sheen = ctx.createLinearGradient(0, 0, w * 0.9, h);
    sheen.addColorStop(0, `rgba(255, 255, 255, ${c.light * 0.7})`);
    sheen.addColorStop(0.45, "rgba(255, 255, 255, 0)");
    sheen.addColorStop(0.8, `rgba(58, 50, 40, ${c.dark * 0.8})`);
    sheen.addColorStop(1, `rgba(58, 50, 40, ${c.dark * 0.3})`);
    ctx.fillStyle = sheen;
    ctx.fillRect(0, 0, w, h);
    const band = (vertical, at, span) => {
      const g = vertical
        ? ctx.createLinearGradient(at - span / 2, 0, at + span / 2, 0)
        : ctx.createLinearGradient(0, at - span / 2, 0, at + span / 2);
      g.addColorStop(0, "rgba(255, 255, 255, 0)");
      g.addColorStop(0.34, `rgba(255, 255, 255, ${c.light})`);
      g.addColorStop(0.5, "rgba(0, 0, 0, 0)");
      g.addColorStop(0.66, `rgba(58, 50, 40, ${c.dark})`);
      g.addColorStop(1, "rgba(58, 50, 40, 0)");
      ctx.fillStyle = g;
      if (vertical) ctx.fillRect(at - span / 2, 0, span, h);
      else ctx.fillRect(0, at - span / 2, w, span);
    };
    // folded in three, the way a slip goes into a wallet, and once across
    band(true, w * 0.333, 34);
    band(true, w * 0.667, 30);
    band(false, h * 0.62, 26);

    // and the small folds a slip picks up in a pocket: short, uneven lines,
    // each a lit edge with its shade just beside it. Seeded, so every redraw
    // is the same slip; kept faint, so the print still reads over them. The
    // shade stays lighter than the lit edge, so more of them reads as paper
    // bent rather than as grime.
    let seed = 0x51ed270b;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
    const line = (x, y, angle, len, bend) => {
      const dx = Math.cos(angle) * len, dy = Math.sin(angle) * len;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x + dx / 2 - dy * bend, y + dy / 2 + dx * bend, x + dx, y + dy);
    };
    ctx.lineCap = "round";
    for (let i = 0, n = 14; i < n; i++) {
      const x = w * (0.05 + rnd() * 0.9);
      const y = h * (0.04 + rnd() * 0.92);
      const angle = (rnd() < 0.5 ? 1 : -1) * (0.45 + rnd() * 0.95);
      const len = 34 + rnd() * 86;
      const bend = (rnd() - 0.5) * 0.3;
      const wide = 1.7 + rnd() * 1.5;
      // the lit side first, then the shade a hair below and right of it; both
      // softened, so a fold reads as a crease rather than a scratch. The shade
      // is drawn thinner and paler than the light, so more folds deepen the
      // paper's bend without ever gathering into a dirty smudge.
      ctx.save();
      ctx.translate(-0.7, -0.8);
      ctx.shadowColor = `rgba(255, 255, 255, ${c.light * 1.05})`;
      ctx.shadowBlur = wide * 2.4;
      line(x, y, angle, len, bend);
      ctx.strokeStyle = `rgba(255, 255, 255, ${c.light})`;
      ctx.lineWidth = wide;
      ctx.stroke();
      ctx.restore();
      ctx.save();
      ctx.translate(0.7, 0.8);
      ctx.shadowColor = `rgba(58, 50, 40, ${c.dark * 0.8})`;
      ctx.shadowBlur = wide * 2.4;
      line(x, y, angle, len, bend);
      ctx.strokeStyle = `rgba(58, 50, 40, ${c.dark * 0.55})`;
      ctx.lineWidth = wide * 0.8;
      ctx.stroke();
      ctx.restore();
    }
  }

  // the paper's grain: one small tile of faint specks and fibres, repeated
  // over the slip. Built once per scale and kept, so a redraw costs a pattern
  // rather than a new tile; seeded, so every redraw is the same paper. The
  // tile is a bitmap at the card's scale, drawn back at the layout's size, so
  // a speck is a point of the slip at 2× and at 3× alike.
  const grains = new Map();
  function grain(scale) {
    const key = String(scale);
    if (grains.has(key)) return grains.get(key);
    const tile = LOOK.grain.tile;
    const px = Math.round(tile * scale);
    const cv = document.createElement("canvas");
    cv.width = cv.height = px;
    const g = cv.getContext("2d");
    let seed = 0x9e3779b9;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
    // specks, half a shade darker than the paper and half a shade lighter
    for (let i = 0, n = tile * tile * 0.05; i < n; i++) {
      const a = 0.02 + rnd() * 0.045;
      g.fillStyle = rnd() > 0.5 ? `rgba(126, 116, 98, ${a})` : `rgba(255, 255, 255, ${a})`;
      g.fillRect(Math.floor(rnd() * tile) * scale, Math.floor(rnd() * tile) * scale, scale, scale);
    }
    // a few short fibres, the way machine-made paper runs
    g.lineWidth = scale;
    for (let i = 0, n = tile * 0.35; i < n; i++) {
      const x = rnd() * px, y = rnd() * px, len = (2 + rnd() * 5) * scale;
      g.strokeStyle = `rgba(126, 116, 98, ${0.015 + rnd() * 0.02})`;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + len, y + (rnd() - 0.5) * scale * 0.8);
      g.stroke();
    }
    grains.set(key, cv);
    return cv;
  }

  async function draw() {
    const day = state.day;
    if (!day) return;
    const n = ++state.drawn;
    const bg = state.bg;
    await fonts;
    const c = V.card(day, lang, { span: state.span, by: state.by });
    const icons = new Map();
    const [img] = await Promise.all([
      backdrop(bg),
      ...[...new Set(c.agents.flatMap((a) => [a.icon, ...a.models.map((m) => m.icon)]))].map(async (n) => icons.set(n, await picture(n))),
    ]);
    if (state.day !== day || n !== state.drawn) return;
    const scale = Math.max(2, Math.min(3, Math.ceil(window.devicePixelRatio || 1)));

    // measure, then draw
    const measured = slip(document.createElement("canvas").getContext("2d"), c, new Map(), 1);
    const ph = measured.h + TOOTH;
    const none = bg.bg === "none";
    const side = none ? 0 : bg.pad;
    const W = PW + side * 2;
    const H = ph + side * 2;
    const top = side;
    const cv = $("card");
    cv.width = W * scale;
    cv.height = H * scale;
    cv.style.aspectRatio = `${W} / ${H}`;
    const ctx = cv.getContext("2d");
    ctx.setTransform(scale, 0, 0, scale, 0, 0);

    // the backdrop the reader picked
    B.paint(ctx, W, H, scale, bg, img);

    // the paper, torn along its foot, and its shadow
    ctx.save();
    ctx.translate(side, top);
    const paper = new Path2D();
    paper.moveTo(0, 0);
    paper.lineTo(PW, 0);
    paper.lineTo(PW, ph - TOOTH);
    const teeth = Math.max(1, Math.round(PW / TOOTH_PITCH));
    const tw = PW / teeth;
    for (let i = teeth - 1; i >= 0; i--) {
      paper.lineTo(i * tw + tw / 2, ph);
      paper.lineTo(i * tw, ph - TOOTH);
    }
    paper.closePath();

    // the paper's shadow: its own save/restore, so neither the blur nor the
    // offset is still set when the slip's text is drawn
    ctx.save();
    ctx.shadowColor = none ? "transparent" : fade(B.meta(bg.bg).shadow, LOOK.paper.alpha);
    ctx.shadowBlur = LOOK.paper.blur;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = LOOK.paper.offsetY;
    ctx.fillStyle = PAPER;
    ctx.fill(paper);
    ctx.restore();

    // the paper's grain, clipped to the torn edge so it stops at the paper.
    // The tile is a bitmap in device pixels and the slip is drawn in points,
    // so the pattern is scaled back to one tile pixel a point.
    ctx.save();
    ctx.clip(paper);
    const pat = ctx.createPattern(grain(scale), "repeat");
    if (pat?.setTransform) pat.setTransform(new DOMMatrix([1 / scale, 0, 0, 1 / scale, 0, 0]));
    ctx.globalAlpha = LOOK.grain.alpha;
    ctx.fillStyle = pat;
    ctx.fillRect(0, 0, PW, ph);
    ctx.restore();

    // the folds, inside the torn edge too, and under the ink; the reader can
    // turn them off and have the slip flat
    if (bg.aged) {
      ctx.save();
      ctx.clip(paper);
      creases(ctx, PW, ph);
      ctx.restore();
    }

    // the slip's ink on a sheet of its own: the head's wear takes the ink off
    // it, and the worn ink is what prints on the paper, so a fault leaves the
    // paper's own grain and folds untouched. A flat slip (aged off) is printed
    // clean, as it comes from a head that is running well.
    const sheet = document.createElement("canvas");
    sheet.width = Math.round(PW * scale);
    sheet.height = Math.round(ph * scale);
    const ink = sheet.getContext("2d");
    ink.setTransform(scale, 0, 0, scale, 0, 0);
    const drawn = slip(ink, c, icons, scale);
    if (bg.aged) press(ink, PW, ph, drawn.heavy, scale);
    ctx.save();
    ctx.clip(paper);
    ctx.drawImage(sheet, 0, 0, PW, ph);
    ctx.restore();
    ctx.restore();
    $("copy").disabled = $("save").disabled = !magpie.image;
    state.size = [W, H];
    fitCard();
  }

  // The card is drawn as large as the page allows, but no taller than the
  // room under the bar, so a whole day is on one screen. The bitmap (and
  // the picture copied or saved) is unchanged: only its size on the page.
  function fitCard() {
    if (!state.size) return;
    const [W, H] = state.size;
    const m = $("main");
    const cs = getComputedStyle(document.body);
    const availW = m.clientWidth;
    const availH = window.innerHeight - m.getBoundingClientRect().top - (parseFloat(cs.paddingBottom) || 0);
    $("card").style.width = `${B.fit(availW, availH, W, H, 760, 160)}px`;
  }
  addEventListener("resize", fitCard);
  new ResizeObserver(fitCard).observe(document.querySelector("header"));
  new ResizeObserver(fitCard).observe($("status"));

  // ---- reading a day ----
  async function load(date) {
    const n = ++state.loading;
    try {
      const span = state.span;
      const params = { date: date || "", tz: zone };
      if (span !== "day") {
        // a week or a month ends on a date, so today's is worked out here
        const end = date || state.day?.today || new Date().toLocaleDateString("en-CA");
        params.date = end;
        params.from = V.spanFrom(span, end);
      }
      const day = await magpie.read("usage:day", params);
      if (n !== state.loading) return;
      // a magpie from before spans answers one day and no `from`
      if (span !== "day" && !day.from) throw new Error("usage:day from");
      state.day = day;
      state.date = day.date;
      status("");
    } catch (e) {
      if (n !== state.loading) return;
      const m = String(e?.message || e);
      // a magpie from before usage:day refuses it as a read it doesn't have
      status(m === "usage:day from" ? V.text(lang).updateSpan : /usage:day/.test(m) ? V.text(lang).update : `${V.text(lang).failed}: ${m}`, true, true);
    }
    paintBar();
    await draw();
  }

  function paintBar() {
    const d = state.day;
    const t = V.text(lang);
    const span = state.span;
    $("date-text").textContent = !d ? "…" : span === "all" ? t.allTime : span === "day" || !d.from ? V.dateLabel(d.date, lang) : `${V.dateLabel(d.from, lang, true)} – ${V.dateLabel(d.date, lang, true)}`;
    const all = span === "all";
    $("next").disabled = !d || all || d.date >= d.today;
    $("today").disabled = !d || all || d.date === d.today;
    $("prev").disabled = !d || all;
    $("date").disabled = all;
    for (const [id, key] of [["prev", span === "day" ? "prev" : "earlier"], ["next", span === "day" ? "next" : "later"]]) {
      $(id).setAttribute("aria-label", t[key]);
      $(id).title = t[key];
    }
    document.querySelectorAll("#spans [data-span]").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.span === span)));
    document.querySelectorAll("#modes [data-by]").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.by === state.by)));
  }

  // ---- the day menu: the days that had calls, newest first ----
  const menu = $("menu");
  let menuOpening = 0;
  async function openMenu() {
    const d = state.day;
    if (!d) return;
    // a day or span in the past knows only the days up to it: the days
    // after it come from a read of today's
    let latest = d.days;
    if (d.date !== d.today) {
      const n = ++menuOpening;
      try { latest = (await magpie.read("usage:day", { date: "", tz: zone })).days; } catch { latest = null; }
      if (n !== menuOpening || state.day !== d) return;
    }
    const days = V.menuDays(d.days, d.today, latest);
    menu.replaceChildren(...days.map((x) => {
      const li = document.createElement("li");
      li.setAttribute("role", "option");
      li.dataset.date = x.date;
      li.setAttribute("aria-selected", String(x.date === d.date));
      const a = document.createElement("span");
      a.textContent = V.dateLabel(x.date, lang);
      const b = document.createElement("span");
      b.textContent = x.tokens ? V.count(x.tokens, lang) : "";
      li.append(a, b);
      return li;
    }));
    menu.hidden = false;
    menu.classList.remove("closing");
    menu.classList.add("opening");
    $("date").setAttribute("aria-expanded", "true");
    requestAnimationFrame(() => menu.classList.remove("opening"));
    menu.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }
  function closeMenu() {
    menuOpening++;
    if (menu.hidden) return;
    $("date").setAttribute("aria-expanded", "false");
    menu.classList.add("closing");
    setTimeout(() => { if (menu.classList.contains("closing")) { menu.hidden = true; menu.classList.remove("closing"); } }, 110);
  }
  $("date").addEventListener("click", (e) => {
    e.stopPropagation();
    if (menu.hidden || menu.classList.contains("closing")) openMenu(); else closeMenu();
  });
  menu.addEventListener("click", (e) => {
    const li = e.target.closest("li");
    if (!li) return;
    closeMenu();
    if (li.dataset.date !== state.date) load(li.dataset.date);
  });
  document.addEventListener("click", (e) => { if (!e.target.closest(".pick")) closeMenu(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeMenu(); });

  $("prev").addEventListener("click", () => state.date && load(V.stepDate(state.span, state.date, -1, state.day?.today || state.date)));
  $("next").addEventListener("click", () => state.date && state.day && state.date < state.day.today && load(V.stepDate(state.span, state.date, 1, state.day.today)));
  $("today").addEventListener("click", () => load(""));
  $("spans").addEventListener("click", (e) => {
    const b = e.target.closest("[data-span]");
    if (!b || b.dataset.span === state.span) return;
    state.span = b.dataset.span;
    paintBar();
    load(state.date === state.day?.today ? "" : state.date);
  });
  $("modes").addEventListener("click", (e) => {
    const b = e.target.closest("[data-by]");
    if (!b || b.dataset.by === state.by) return;
    state.by = b.dataset.by;
    paintBar();
    draw();
  });

  // ---- the backdrop: a pattern, a photo from bg/, or the reader's picture ----
  const images = new Map();
  function image(src) {
    if (!images.has(src)) {
      images.set(src, new Promise((ok) => {
        const img = new Image();
        img.onload = () => ok(img);
        img.onerror = () => ok(null);
        img.src = src;
      }));
    }
    return images.get(src);
  }
  // a script of the page's own (bg/<id>.js, bg/thumbs.js): the photos come
  // as data: so the canvas they're drawn on can still be saved
  const scripts = new Map();
  function script(file) {
    if (!scripts.has(file)) {
      scripts.set(file, new Promise((ok) => {
        const s = document.createElement("script");
        s.src = file;
        s.onload = () => ok(true);
        s.onerror = () => { scripts.delete(file); ok(false); };
        document.head.append(s);
      }));
    }
    return scripts.get(file);
  }
  async function photoSrc(id) {
    if (!globalThis.DayPhotos?.[id]) await script(`bg/${id}.js`);
    return globalThis.DayPhotos?.[id] || "";
  }
  // the picture under bg, loaded; null for a pattern
  async function backdrop(bg) {
    if (!B.meta(bg.bg).photo) return null;
    const src = bg.bg === "custom" ? bg.image : await photoSrc(bg.bg);
    return src ? image(src) : null;
  }

  // the reader's pick, kept in the plugin's options; magpie takes a write a
  // second at most, so a slider's run is saved once it settles
  let saveTimer = 0;
  function keep() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      try {
        await magpie.options.set({ ...state.bg });
      } catch (e) {
        if (/429|too many/i.test(String(e?.message || e))) keep();
        else status(`${V.text(lang).keepFailed}: ${e?.message || e}`, true);
      }
    }, 1100);
  }
  function pick(o) {
    state.bg = B.norm({ ...state.bg, ...o });
    paintPicker();
    keep();
    draw();
  }

  const pop = $("bg-pop");
  const grid = $("bg-grid");
  function swatch(id) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "sw";
    b.dataset.bg = id;
    b.setAttribute("role", "radio");
    return b;
  }
  // a pattern's swatch, drawn by the code that draws the card
  function patternCanvas(id, size) {
    const cv = document.createElement("canvas");
    const s = Math.max(1, Math.min(3, Math.ceil(window.devicePixelRatio || 1)));
    cv.width = cv.height = size * s;
    const ctx = cv.getContext("2d");
    ctx.setTransform(s, 0, 0, s, 0, 0);
    if (id === "none") {
      // nothing, shown the way a picture editor shows it: a chequerboard
      const q = size / 6;
      for (let y = 0; y < 6; y++) for (let x = 0; x < 6; x++) { ctx.fillStyle = (x + y) % 2 ? "#cfcfd4" : "#fafafa"; ctx.fillRect(x * q, y * q, q, q); }
      return cv;
    }
    B.paint(ctx, size, size, s, { ...state.bg, bg: id }, null);
    return cv;
  }
  async function buildGrid() {
    await script("bg/thumbs.js");
    const t = V.text(lang);
    const list = B.list.map((m) => {
      const b = swatch(m.id);
      if (m.photo) {
        const img = document.createElement("img");
        img.alt = "";
        img.src = globalThis.DayThumbs?.[m.id] || "";
        b.append(img);
      } else {
        b.append(patternCanvas(m.id, 60));
      }
      return b;
    });
    if (state.bg.image) {
      const b = swatch("custom");
      const img = document.createElement("img");
      img.alt = "";
      img.src = state.bg.image;
      b.append(img);
      // the reader's picture can go again: a badge at its corner, shown on
      // hover or focus, and always where there is no hover (netube99 on X)
      const own = document.createElement("span");
      own.className = "sw-own";
      const del = document.createElement("button");
      del.type = "button";
      del.className = "sw-del";
      del.id = "bg-del";
      del.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m5 5 6 6M11 5l-6 6"/></svg>';
      del.setAttribute("aria-label", t.removeImage);
      del.title = t.removeImage;
      own.append(b, del);
      list.push(own);
    }
    const add = document.createElement("button");
    add.type = "button";
    add.className = "sw add";
    add.id = "bg-add";
    add.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M3 8h10"/></svg>';
    add.setAttribute("aria-label", t.upload);
    add.title = t.upload;
    list.push(add);
    grid.replaceChildren(...list);
    paintPicker();
  }
  function paintPicker() {
    const t = V.text(lang);
    const bg = state.bg;
    grid.querySelectorAll(".sw[data-bg]").forEach((b) => {
      const name = t[`bg-${b.dataset.bg}`];
      b.setAttribute("aria-label", name);
      b.title = name;
      b.setAttribute("aria-checked", String(b.dataset.bg === bg.bg));
    });
    $("pad").value = bg.pad;
    $("blur").value = bg.blur;
    $("dim").value = bg.dim;
    $("aged").checked = bg.aged;
    pop.classList.toggle("photo", B.meta(bg.bg).photo === true);
    pop.classList.toggle("none", bg.bg === "none");
    paintChip();
  }
  async function paintChip() {
    const cv = $("bg-chip");
    const s = Math.max(1, Math.min(3, Math.ceil(window.devicePixelRatio || 1)));
    cv.width = cv.height = 14 * s;
    const ctx = cv.getContext("2d");
    ctx.setTransform(s, 0, 0, s, 0, 0);
    const bg = state.bg;
    const img = await backdrop(bg);
    if (bg !== state.bg) return;
    if (bg.bg === "none") ctx.drawImage(patternCanvas("none", 14), 0, 0, 14, 14);
    else B.paint(ctx, 14, 14, s, bg, img);
  }

  function openPop() {
    if (!grid.childElementCount) buildGrid();
    pop.hidden = false;
    // the menu hangs from the button's right edge; where the toolbar wrapped
    // and the button sits at the left, that runs off the page, so it hangs
    // from the button's left edge instead
    pop.classList.toggle("left", $("bg").getBoundingClientRect().right < pop.offsetWidth + 8);
    pop.classList.remove("closing");
    pop.classList.add("opening");
    $("bg").setAttribute("aria-expanded", "true");
    requestAnimationFrame(() => pop.classList.remove("opening"));
  }
  function closePop() {
    if (pop.hidden) return;
    $("bg").setAttribute("aria-expanded", "false");
    pop.classList.add("closing");
    setTimeout(() => { if (pop.classList.contains("closing")) { pop.hidden = true; pop.classList.remove("closing"); } }, 120);
  }
  $("bg").addEventListener("click", (e) => {
    e.stopPropagation();
    if (pop.hidden || pop.classList.contains("closing")) openPop(); else closePop();
  });
  grid.addEventListener("click", (e) => {
    if (e.target.closest("#bg-del")) {
      // the grid is drawn again under the click, so it isn't read as a
      // click outside the menu
      e.stopPropagation();
      dropPicture();
      return;
    }
    const b = e.target.closest(".sw");
    if (!b) return;
    if (b.id === "bg-add") $("file").click();
    else pick({ bg: b.dataset.bg });
  });
  for (const id of ["pad", "blur", "dim"]) $(id).addEventListener("input", (e) => pick({ [id]: e.target.value }));
  $("aged").addEventListener("change", (e) => pick({ aged: e.target.checked }));
  document.addEventListener("click", (e) => { if (!e.target.closest(".bgpick")) closePop(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closePop(); });

  // the reader's own picture, made small enough for the options magpie
  // keeps (64KB a plugin): a JPEG of at most ~44KB as data:
  const readFile = (file) => new Promise((ok, no) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result));
    r.onerror = () => no(r.error);
    r.readAsDataURL(file);
  });
  async function usePicture(file) {
    if (!file || !/^image\//.test(file.type)) return;
    try {
      const img = await image(await readFile(file));
      if (!img) throw new Error(file.name || "?");
      const iw = img.naturalWidth, ih = img.naturalHeight;
      let out = "";
      for (const edge of [960, 800, 640, 520, 400]) {
        const k = Math.min(1, edge / Math.max(iw, ih));
        const cv = document.createElement("canvas");
        cv.width = Math.max(1, Math.round(iw * k));
        cv.height = Math.max(1, Math.round(ih * k));
        const ctx = cv.getContext("2d");
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(img, 0, 0, cv.width, cv.height);
        for (const q of [0.82, 0.72, 0.62]) {
          out = cv.toDataURL("image/jpeg", q);
          if (out.length <= 44000) break;
        }
        if (out.length <= 44000) break;
      }
      if (out.length > 44000) throw new Error(file.name || "?");
      pick({ bg: "custom", image: out });
      buildGrid();
    } catch (e) {
      status(`${V.text(lang).imageFailed}: ${e?.message || e}`, true);
    }
  }
  // the picture leaves the saved options; a card drawn on it goes back to
  // the default backdrop (norm), and focus stays in the menu
  function dropPicture() {
    pick({ image: "" });
    buildGrid().then(() => $("bg-add")?.focus());
  }
  $("file").addEventListener("change", (e) => {
    usePicture(e.target.files?.[0]);
    e.target.value = "";
  });
  // a picture dropped on the page or pasted works as well as the picker
  const main = document.querySelector("main");
  document.addEventListener("dragover", (e) => {
    if (![...(e.dataTransfer?.items || [])].some((i) => i.kind === "file")) return;
    e.preventDefault();
    main.classList.add("drop");
  });
  document.addEventListener("dragleave", (e) => { if (!e.relatedTarget) main.classList.remove("drop"); });
  document.addEventListener("drop", (e) => {
    main.classList.remove("drop");
    const f = [...(e.dataTransfer?.files || [])].find((f) => /^image\//.test(f.type));
    if (!f) return;
    e.preventDefault();
    usePicture(f);
  });
  document.addEventListener("paste", (e) => {
    const f = [...(e.clipboardData?.files || [])].find((f) => /^image\//.test(f.type));
    if (f) usePicture(f);
  });

  // ---- sharing ----
  const png = () => new Promise((ok, no) => $("card").toBlob((b) => (b ? ok(b) : no(new Error("no picture"))), "image/png"));
  $("copy").addEventListener("click", async () => {
    const b = $("copy");
    b.disabled = true;
    try {
      await magpie.image.copy(await png());
      b.textContent = V.text(lang).copied;
      setTimeout(() => { b.textContent = V.text(lang).copy; }, 1500);
    } catch (e) {
      status(`${V.text(lang).shareFailed}: ${e?.message || e}`, true);
    } finally {
      b.disabled = false;
    }
  });
  $("save").addEventListener("click", async () => {
    const b = $("save");
    b.disabled = true;
    try {
      const r = await magpie.image.save(await png(), V.fileName(state.date, state.span, state.day?.from));
      if (r?.path) status(`${V.text(lang).saved} ${r.path}`);
    } catch (e) {
      status(`${V.text(lang).shareFailed}: ${e?.message || e}`, true);
    } finally {
      b.disabled = false;
    }
  });

  magpie.onTheme((t) => { lang = t.lang; words(); paintBar(); if (grid.childElementCount) paintPicker(); draw(); });
  // today's numbers keep coming while the page is open
  setInterval(() => { if (state.day && state.date === state.day.today && document.visibilityState !== "hidden") load(state.date); }, 60_000);
  words();
  paintBar();
  try {
    state.bg = B.norm(await magpie.options.get());
  } catch {
    // the default backdrop, until the reader picks one
  }
  paintPicker();
  await load("");
})();
