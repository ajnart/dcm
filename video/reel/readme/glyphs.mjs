import { readFileSync } from "node:fs";
import { brotliDecompressSync } from "node:zlib";

const TAGS = "cmap head hhea hmtx maxp name OS/2 post cvt fpgm glyf loca prep CFF VORG EBDT EBLC gasp hdmx kern LTSH PCLT VDMX vhea vmtx BASE GDEF GPOS GSUB EBSC JSTF MATH CBDT CBLC COLR CPAL SVG sbix acnt avar bdat bloc bsln cvar fdsc feat fmtx fvar gvar hsty just lcar mort morx opbd prop trak Zapf Silf Glat Gloc Feat Sill".split(" ");

const reader = (buf) => {
  let p = 0;
  return {
    get pos() { return p; },
    u8: () => buf[p++],
    u16: () => ((p += 2), buf.readUInt16BE(p - 2)),
    i16: () => ((p += 2), buf.readInt16BE(p - 2)),
    i8: () => ((p += 1), buf.readInt8(p - 1)),
    u32: () => ((p += 4), buf.readUInt32BE(p - 4)),
    base128() {
      let v = 0;
      for (let i = 0; i < 5; i++) {
        const b = buf[p++];
        v = v * 128 + (b & 0x7f);
        if (!(b & 0x80)) return v;
      }
      throw new Error("bad UIntBase128");
    },
    u255() {
      const c = buf[p++];
      if (c === 253) return this.u16();
      if (c === 254) return buf[p++] + 506;
      if (c === 255) return buf[p++] + 253;
      return c;
    },
    skip: (n) => (p += n),
  };
};

const withSign = (flag, v) => (flag & 1 ? v : -v);

const triplet = (flag, glyph) => {
  const f = flag & 0x7f;
  const b = (n) => glyph.u8();
  let dx, dy;
  if (f < 10) {
    dx = 0;
    dy = withSign(f, ((f & 14) << 7) + b());
  } else if (f < 20) {
    dx = withSign(f, (((f - 10) & 14) << 7) + b());
    dy = 0;
  } else if (f < 84) {
    const b0 = f - 20, b1 = b();
    dx = withSign(f, 1 + (b0 & 0x30) + (b1 >> 4));
    dy = withSign(f >> 1, 1 + ((b0 & 0x0c) << 2) + (b1 & 0x0f));
  } else if (f < 120) {
    const b0 = f - 84, x = b(), y = b();
    dx = withSign(f, 1 + ((b0 / 12 | 0) << 8) + x);
    dy = withSign(f >> 1, 1 + ((((b0 % 12) >> 2)) << 8) + y);
  } else if (f < 124) {
    const x = b(), m = b(), y = b();
    dx = withSign(f, (x << 4) + (m >> 4));
    dy = withSign(f >> 1, ((m & 0x0f) << 8) + y);
  } else {
    const x1 = b(), x2 = b(), y1 = b(), y2 = b();
    dx = withSign(f, (x1 << 8) + x2);
    dy = withSign(f >> 1, (y1 << 8) + y2);
  }
  return [dx, dy, !(flag & 0x80)];
};

const tables = (buf) => {
  const r = reader(buf);
  if (r.u32() !== 0x774f4632) throw new Error("not a WOFF2 file");
  r.skip(8);
  const n = r.u16();
  r.skip(2 + 4);
  const compressed = r.u32();
  r.skip(2 + 2 + 4 * 5);
  const dir = [];
  for (let i = 0; i < n; i++) {
    const flags = r.u8();
    const tag = (flags & 63) === 63 ? String.fromCharCode(r.u8(), r.u8(), r.u8(), r.u8()) : TAGS[flags & 63];
    const version = flags >> 6;
    const orig = r.base128();
    const transformed = tag === "glyf" || tag === "loca" ? version === 0 : version !== 0;
    dir.push({ tag, transformed, length: transformed ? r.base128() : orig });
  }
  const data = brotliDecompressSync(buf.subarray(r.pos, r.pos + compressed));
  const out = {};
  let at = 0;
  for (const t of dir) {
    out[t.tag] = { transformed: t.transformed, data: data.subarray(at, at + t.length) };
    at += t.length;
  }
  return out;
};

const glyphs = (data, numGlyphs) => {
  const h = reader(data);
  h.skip(8);
  const sizes = [h.u32(), h.u32(), h.u32(), h.u32(), h.u32(), h.u32(), h.u32()];
  let at = h.pos;
  const streams = sizes.map((s) => {
    const r = reader(data.subarray(at, at + s));
    at += s;
    return r;
  });
  const [nContour, nPoints, flags, glyph, composite] = streams;
  const out = [];
  for (let g = 0; g < numGlyphs; g++) {
    const nc = nContour.i16();
    if (nc === 0) {
      out.push([]);
    } else if (nc > 0) {
      const counts = Array.from({ length: nc }, () => nPoints.u255());
      const total = counts.reduce((a, b) => a + b, 0);
      const fl = Array.from({ length: total }, () => flags.u8());
      let x = 0, y = 0;
      const pts = fl.map((f) => {
        const [dx, dy, on] = triplet(f, glyph);
        x += dx;
        y += dy;
        return [x, y, on];
      });
      glyph.u255();
      const contours = [];
      let i = 0;
      for (const c of counts) {
        contours.push(pts.slice(i, i + c));
        i += c;
      }
      out.push(contours);
    } else {
      let more = true, instructions = false;
      const parts = [];
      while (more) {
        const f = composite.u16();
        const gid = composite.u16();
        const words = f & 1;
        const read = () => (words ? composite.i16() : composite.i8());
        const dx = read(), dy = read();
        let sx = 1, sy = 1;
        if (f & 0x08) sx = sy = composite.i16() / 16384;
        else if (f & 0x40) [sx, sy] = [composite.i16() / 16384, composite.i16() / 16384];
        else if (f & 0x80) composite.skip(8);
        parts.push({ gid, dx, dy, sx, sy });
        more = !!(f & 0x20);
        instructions = !!(f & 0x100);
      }
      if (instructions) glyph.u255();
      out.push(parts);
    }
  }
  return out;
};

const cmap = (data) => {
  const r = reader(data);
  r.u16();
  const n = r.u16();
  let best;
  for (let i = 0; i < n; i++) {
    const platform = r.u16(), enc = r.u16(), offset = r.u32();
    if ((platform === 3 && enc === 10) || (!best && ((platform === 3 && enc === 1) || platform === 0))) best = offset;
  }
  const t = data.subarray(best);
  const format = t.readUInt16BE(0);
  const map = new Map();
  if (format === 4) {
    const segs = t.readUInt16BE(6) / 2;
    const end = 14, start = end + segs * 2 + 2, delta = start + segs * 2, range = delta + segs * 2;
    for (let s = 0; s < segs; s++) {
      const e = t.readUInt16BE(end + s * 2), b = t.readUInt16BE(start + s * 2);
      const d = t.readInt16BE(delta + s * 2), ro = t.readUInt16BE(range + s * 2);
      for (let c = b; c <= e && c !== 0xffff; c++) {
        let gid = ro === 0 ? (c + d) & 0xffff : t.readUInt16BE(range + s * 2 + ro + (c - b) * 2);
        if (ro !== 0 && gid) gid = (gid + d) & 0xffff;
        if (gid) map.set(c, gid);
      }
    }
  } else if (format === 12) {
    const groups = t.readUInt32BE(12);
    for (let g = 0; g < groups; g++) {
      const b = t.readUInt32BE(16 + g * 12), e = t.readUInt32BE(20 + g * 12), gid = t.readUInt32BE(24 + g * 12);
      for (let c = b; c <= e; c++) map.set(c, gid + c - b);
    }
  } else throw new Error(`cmap format ${format}`);
  return map;
};

const num = (n) => String(Math.round(n * 100) / 100);

const contourPath = (pts) => {
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  let start = pts.findIndex((p) => p[2]);
  let ordered;
  let first;
  if (start >= 0) {
    ordered = pts.slice(start + 1).concat(pts.slice(0, start + 1));
    first = pts[start];
  } else {
    first = mid(pts[0], pts[pts.length - 1]);
    ordered = pts.slice();
  }
  const f = (p) => `${num(p[0])} ${num(-p[1])}`;
  let d = `M${f(first)}`;
  let off = null;
  for (const p of ordered) {
    if (p[2]) {
      d += off ? `Q${f(off)} ${f(p)}` : `L${f(p)}`;
      off = null;
    } else {
      if (off) d += `Q${f(off)} ${f(mid(off, p))}`;
      off = p;
    }
  }
  if (off) d += `Q${f(off)} ${f(first)}`;
  return `${d}Z`;
};

const f2 = (b, o) => b.readInt16BE(o) / 16384;

const axes = (t, wght) => {
  const fv = t.fvar.data;
  const off = fv.readUInt16BE(4);
  const lo = fv.readInt32BE(off + 4) / 65536, mid = fv.readInt32BE(off + 8) / 65536, hi = fv.readInt32BE(off + 12) / 65536;
  let c = wght < mid ? (wght - mid) / (mid - lo) : wght > mid ? (wght - mid) / (hi - mid) : 0;
  c = Math.max(-1, Math.min(1, c));
  if (t.avar) {
    const a = t.avar.data;
    const n = a.readUInt16BE(6);
    const maps = [];
    for (let i = 0, p = 8; i < n; i++) {
      const m = a.readUInt16BE(p);
      p += 2;
      maps.push([...Array(m)].map((_, j) => [f2(a, p + j * 4), f2(a, p + j * 4 + 2)]));
      p += m * 4;
    }
    const seg = maps[0];
    for (let i = 1; i < seg.length; i++) {
      if (c <= seg[i][0]) {
        const [a0, b0] = seg[i - 1], [a1, b1] = seg[i];
        c = a1 === a0 ? b1 : b0 + ((c - a0) * (b1 - b0)) / (a1 - a0);
        break;
      }
    }
  }
  return [c];
};

const packedPoints = (r) => {
  let n = r.u8();
  if (n & 0x80) n = ((n & 0x7f) << 8) | r.u8();
  if (n === 0) return null;
  const pts = [];
  let last = 0;
  while (pts.length < n) {
    const c = r.u8();
    const words = c & 0x80;
    for (let k = (c & 0x7f) + 1; k > 0; k--) {
      last += words ? r.u16() : r.u8();
      pts.push(last);
    }
  }
  return pts;
};

const packedDeltas = (r, n) => {
  const out = [];
  while (out.length < n) {
    const c = r.u8();
    for (let k = (c & 0x3f) + 1; k > 0; k--) out.push(c & 0x80 ? 0 : c & 0x40 ? r.i16() : r.i8());
  }
  return out;
};

const iup = (orig, delta, touched, ends) => {
  let start = 0;
  for (const end of ends) {
    const idx = [];
    for (let i = start; i <= end; i++) if (touched[i]) idx.push(i);
    if (idx.length === 1) for (let i = start; i <= end; i++) delta[i] = delta[idx[0]];
    else if (idx.length > 1) {
      for (let k = 0; k < idx.length; k++) {
        const a = idx[k], b = idx[(k + 1) % idx.length];
        for (let i = a + 1 === end + 1 ? start : a + 1; i !== b; i = i === end ? start : i + 1) {
          const [c1, c2, d1, d2] = [orig[a], orig[b], delta[a], delta[b]];
          const c = orig[i];
          if (c1 === c2) delta[i] = d1 === d2 ? d1 : 0;
          else if (c <= Math.min(c1, c2)) delta[i] = c1 <= c2 ? d1 : d2;
          else if (c >= Math.max(c1, c2)) delta[i] = c1 <= c2 ? d2 : d1;
          else delta[i] = d1 + ((c - c1) * (d2 - d1)) / (c2 - c1);
        }
      }
    }
    start = end + 1;
  }
};

const scalar = (peak, start, end, c) => {
  let s = 1;
  for (let a = 0; a < peak.length; a++) {
    const p = peak[a];
    if (p === 0) continue;
    if (c[a] === p) continue;
    if (c[a] < start[a] || c[a] > end[a]) return 0;
    s *= c[a] < p ? (c[a] - start[a]) / (p - start[a]) : (end[a] - c[a]) / (end[a] - p);
  }
  return s;
};

const gvarDeltas = (t, gid, npts, ends, orig, coords) => {
  const g = t.gvar.data;
  const axisCount = g.readUInt16BE(4), sharedCount = g.readUInt16BE(6), sharedOff = g.readUInt32BE(8);
  const long = g.readUInt16BE(14) & 1, base = g.readUInt32BE(16);
  const at = (i) => (long ? g.readUInt32BE(20 + i * 4) : g.readUInt16BE(20 + i * 2) * 2);
  const a = base + at(gid), b = base + at(gid + 1);
  const dx = new Array(npts).fill(0), dy = new Array(npts).fill(0);
  if (a === b) return [dx, dy];
  const count = g.readUInt16BE(a);
  const dataAt = a + g.readUInt16BE(a + 2);
  const heads = [];
  let p = a + 4;
  for (let i = 0; i < (count & 0x0fff); i++) {
    const size = g.readUInt16BE(p), idx = g.readUInt16BE(p + 2);
    p += 4;
    let peak, start, end;
    if (idx & 0x8000) {
      peak = [...Array(axisCount)].map((_, k) => f2(g, p + k * 2));
      p += axisCount * 2;
    } else peak = [...Array(axisCount)].map((_, k) => f2(g, sharedOff + (idx & 0x0fff) * axisCount * 2 + k * 2));
    if (idx & 0x4000) {
      start = [...Array(axisCount)].map((_, k) => f2(g, p + k * 2));
      end = [...Array(axisCount)].map((_, k) => f2(g, p + axisCount * 2 + k * 2));
      p += axisCount * 4;
    } else {
      start = peak.map((v) => Math.min(0, v));
      end = peak.map((v) => Math.max(0, v));
    }
    heads.push({ size, priv: !!(idx & 0x2000), peak, start, end });
  }
  const r = reader(g.subarray(dataAt, b));
  const shared = count & 0x8000 ? packedPoints(r) : undefined;
  for (const h of heads) {
    const mark = r.pos;
    const pts = h.priv ? packedPoints(r) : shared;
    const total = pts ? pts.length : npts + 4;
    const xs = packedDeltas(r, total), ys = packedDeltas(r, total);
    r.skip(mark + h.size - r.pos);
    const s = scalar(h.peak, h.start, h.end, coords);
    if (!s) continue;
    const tx = new Array(npts).fill(0), ty = new Array(npts).fill(0), touched = new Array(npts).fill(!pts);
    (pts || [...Array(total).keys()]).forEach((pi, k) => {
      if (pi < npts) {
        tx[pi] = xs[k];
        ty[pi] = ys[k];
        touched[pi] = true;
      }
    });
    if (pts && ends) {
      iup(orig.map((q) => q[0]), tx, touched, ends);
      iup(orig.map((q) => q[1]), ty, touched, ends);
    }
    for (let i = 0; i < npts; i++) {
      dx[i] += tx[i] * s;
      dy[i] += ty[i] * s;
    }
  }
  return [dx, dy];
};

const hvarAdvance = (t, gid, coords) => {
  const h = t.HVAR.data;
  const store = h.readUInt32BE(4), map = h.readUInt32BE(8);
  let outer = 0, inner = gid;
  if (map) {
    const fmt = h.readUInt8(map + 1), n = h.readUInt16BE(map + 2);
    const size = ((fmt & 0x30) >> 4) + 1, bits = (fmt & 0x0f) + 1;
    let e = 0;
    const o = map + 4 + Math.min(gid, n - 1) * size;
    for (let k = 0; k < size; k++) e = e * 256 + h[o + k];
    outer = e >> bits;
    inner = e & ((1 << bits) - 1);
  }
  const regions = store + h.readUInt32BE(store + 2);
  const axisCount = h.readUInt16BE(regions);
  const data = store + h.readUInt32BE(store + 8 + outer * 4);
  const itemCount = h.readUInt16BE(data), wordCount = h.readUInt16BE(data + 2), regionCount = h.readUInt16BE(data + 4);
  const longWords = !!(wordCount & 0x8000), words = wordCount & 0x7fff;
  const rowSize = longWords ? (words + regionCount) * 2 : words * 2 + (regionCount - words);
  let row = data + 6 + regionCount * 2 + inner * rowSize;
  if (inner >= itemCount) return 0;
  let delta = 0;
  for (let k = 0; k < regionCount; k++) {
    const ri = h.readUInt16BE(data + 6 + k * 2);
    const ro = regions + 4 + ri * axisCount * 6;
    const [start, peak, end] = [0, 1, 2].map((q) => f2(h, ro + q * 2));
    const s = scalar([peak], [start], [end], coords);
    const isWord = k < words;
    const v = longWords ? (isWord ? h.readInt32BE(row) : h.readInt16BE(row)) : isWord ? h.readInt16BE(row) : h.readInt8(row);
    row += longWords ? (isWord ? 4 : 2) : isWord ? 2 : 1;
    delta += v * s;
  }
  return delta;
};

export function loadFont(file, { wght } = {}) {
  const t = tables(readFileSync(file));
  const upm = t.head.data.readUInt16BE(18);
  const numGlyphs = t.maxp.data.readUInt16BE(4);
  const shapes = glyphs(t.glyf.data, numGlyphs);
  const map = cmap(t.cmap.data);
  const hm = t.hmtx.data;
  const metrics = t.hhea.data.readUInt16BE(34);
  const coords = wght === undefined ? null : axes(t, wght);
  const advance = (gid) => hm.readUInt16BE(Math.min(gid, metrics - 1) * 4) + (coords ? Math.round(hvarAdvance(t, gid, coords)) : 0);
  const varied = (gid) => {
    const shape = shapes[gid];
    if (!coords || !shape.length) return shape;
    if (Array.isArray(shape[0])) {
      const flat = shape.flat();
      const ends = shape.map((c, i) => shape.slice(0, i + 1).reduce((a, q) => a + q.length, 0) - 1);
      const [dx, dy] = gvarDeltas(t, gid, flat.length, ends, flat, coords);
      let i = 0;
      return shape.map((c) => c.map(([x, y, on]) => [x + dx[i], y + dy[i++], on]));
    }
    const [dx, dy] = gvarDeltas(t, gid, shape.length, null, null, coords);
    return shape.map((c, i) => ({ ...c, dx: c.dx + dx[i], dy: c.dy + dy[i] }));
  };
  const cache = new Map();
  const outline = (gid, m = [1, 0, 0, 1, 0, 0]) => {
    const shape = varied(gid);
    if (shape.length && !Array.isArray(shape[0])) {
      return shape.map((c) => outline(c.gid, [c.sx * m[0], 0, 0, c.sy * m[3], m[4] + c.dx * m[0], m[5] + c.dy * m[3]])).join("");
    }
    return shape.map((c) => contourPath(c.map(([x, y, on]) => [x * m[0] + m[4], y * m[3] + m[5], on]))).join("");
  };
  const glyph = (ch) => {
    if (cache.has(ch)) return cache.get(ch);
    const gid = map.get(ch.codePointAt(0));
    if (gid === undefined) throw new Error(`no glyph for ${JSON.stringify(ch)}`);
    const g = { id: gid, advance: advance(gid), d: outline(gid) };
    cache.set(ch, g);
    return g;
  };
  return { upm, glyph };
}
