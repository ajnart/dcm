package intro

import (
	"image/color"
	"math"

	"github.com/ajnart/self-host/internal/scene"
)

const (
	dur       = float64(SceneFrames) / FPS
	grav      = 400.0
	hop       = 1.7
	snap      = 1.9
	lightLag  = 0.12
	ripple    = 0.26
	lock0     = snap + 0.34
	lockSpan  = 0.7
	lockJit   = 0.12
	glintAt0  = 2.9
	glintLen  = 0.6
	flickEach = 2.9
	swap      = 0.66
)

var land = [containers]float64{0.72, 1.0, 1.26, 1.48}

type phase int

const (
	phIntro phase = iota
	phWarn
	phFail
	phRecover
	phExit
)

type chk struct {
	age   float64
	level Level
}

type rect struct{ x0, y0, x1, y1 int }

type cardInfo struct {
	kind  Level
	check Check
	since int
	out   int
}

type sctx struct {
	w, h     int
	tier     tier
	t        float64
	wall     int
	pal      Palette
	noColor  bool
	reduced  bool
	checks   [containers]chk
	lastAge  float64
	warned   bool
	reading  bool
	again    bool
	dim      float64
	card     *cardInfo
	cardRect *rect
	phase    phase
	exit     float64
	scale    Scale
	target   Target
	doc      Doctor
	settling bool
}

func newCtx(in Input, exitN int, exiting bool, tg Target) *sctx {
	c := &sctx{w: in.W, h: in.H, tier: in.tier(), wall: in.Wall, pal: in.Pal, noColor: in.NoColor,
		reduced: in.Reduced, reading: in.Doctor.Reading, again: in.Doctor.Again, doc: in.Doctor, target: tg}
	frame := in.Frame
	if in.Reduced {
		frame = SceneFrames
	}
	c.t = float64(frame) / FPS
	c.scale = ScaleMedium
	if c.tier == tierFull {
		c.scale = ScaleFull
	}
	for i := range c.checks {
		c.checks[i] = chk{age: -1}
		if i < len(in.Doctor.Checks) && !in.Doctor.Reading && in.Doctor.litAt(i) <= in.Wall {
			c.checks[i] = chk{age: float64(in.Wall-in.Doctor.litAt(i)) / FPS, level: in.Doctor.Checks[i].Level}
		}
	}
	if n := len(in.Doctor.Checks); n > 0 && !in.Doctor.Reading && in.Doctor.litAt(n-1) <= in.Wall {
		c.lastAge = float64(in.Wall-in.Doctor.litAt(n-1)) / FPS
	}
	for _, k := range in.Doctor.Checks {
		c.warned = c.warned || k.Level == Warn
	}
	h := in.Hold
	if h.Level == Warn || h.Level == Fail {
		for _, k := range in.Doctor.Checks {
			if k.Level == h.Level {
				c.card = &cardInfo{kind: h.Level, check: k, since: h.Since, out: h.Out}
				break
			}
		}
		if c.card != nil && h.Out >= 0 && in.Wall-h.Out >= CardFrames {
			c.card = nil
		}
	}
	switch {
	case exiting:
		c.phase = phExit
		c.exit = float64(exitN) / float64(ExitFrames-1)
	case h.Level == Fail && h.Recover >= 0:
		c.phase = phRecover
		c.dim = 1 - outCubic(float64(in.Wall-h.Recover)/(0.45*FPS))
	case h.Level == Fail:
		c.phase = phFail
		c.dim = outCubic(float64(in.Wall-h.Since) / (0.5 * FPS))
	case h.Level == Warn:
		c.phase = phWarn
	}
	if in.Reduced && c.dim > 0 {
		c.dim = 1
	}
	if c.card != nil {
		r := cardBox(c.w, c.h, c.card)
		c.cardRect = &r
	}
	return c
}

type lay struct {
	bs                       []box
	wm                       *wordmark
	s                        int
	cx, T, G, G0, lx, x0, r0 int
	HL                       int
	vis                      float64
	bx1, logoH               int
}

func (c *sctx) cardRoom() (float64, int) {
	k, room := 0.0, c.h
	switch {
	case c.phase == phFail || c.phase == phRecover:
		k, room = c.dim, c.h-12
	case c.phase == phWarn || (c.phase == phExit && c.warned):
		age := math.Min(c.lastAge, c.t-dur)
		k = 1
		if !c.reduced {
			k = outCubic(age / 0.35)
		}
		room = c.h - 10
	}
	if c.cardRect != nil {
		room = min(room, c.cardRect.y0-2)
	}
	return k, room
}

func (c *sctx) layout() lay {
	lw, lh := c.scale.Size()
	_ = lw
	s := 1
	if c.w >= 116 && c.h-2 >= lh+1+1+7+2 {
		s = 2
	}
	wm := words[s]
	gap := 1
	rows := lh + 1 + gap + wm.R
	T0 := max(1, fl(float64(c.h-2-rows)/2))
	cx := c.w / 2
	k, room := c.cardRoom()
	lift, sink := 0, 0.0
	if k > 0 {
		bottom := T0 + rows - 1
		most := T0 - 1
		if bottom-room <= most {
			lift = max(0, bottom-room)
		} else {
			sink = 1
			lift = min(max(0, T0+lh-room), most)
		}
	}
	kw := 1.0
	if k < 1 {
		kw = outCubic((1 - math.Cbrt(1-k) - 0.25) / 0.75)
	}
	T := T0 - rnd(float64(lift)*k)
	bx1 := c.scale.width()
	return lay{
		bs: rack(c.scale), wm: wm, s: s, cx: cx, T: T, G: T + lh, G0: T0 + lh,
		lx: cx - rnd(float64(bx1)/2), x0: cx - wm.W/2,
		r0: T0 - rnd(float64(lift)*kw) + lh + 1 + gap,
		HL: wm.W/2 + 2*s, vis: 1 - sink*k, bx1: bx1, logoH: lh,
	}
}

func put(cv *scene.Canvas, x, y int, r rune, fg color.RGBA, lum float64) {
	cv.Put(x, y, r, fg, clamp01(lum))
}

func putB(cv *scene.Canvas, x, y int, r rune, fg color.RGBA, lum float64, bold bool) {
	cv.PutBold(x, y, r, fg, clamp01(lum), bold)
}

func dot(cv *scene.Canvas, sx, sy float64, fg color.RGBA, lum float64) {
	cv.Dot(fl(sx), fl(sy), fg, clamp01(lum))
}

func (c *sctx) lightOf(i int) (Level, float64, bool) {
	k := c.checks[i]
	if k.age < 0 {
		return Unlit, 0, false
	}
	landed := c.t - land[i] - lightLag
	if landed < 0 {
		return Unlit, 0, false
	}
	if c.reduced {
		return k.level, 9, true
	}
	return k.level, math.Min(k.age, landed), true
}

func (c *sctx) waiting(b box) float64 {
	if !c.reading || c.reduced || c.t < land[b.i]+0.3 {
		return 0
	}
	pos := math.Mod(c.t/2.2, 1)*float64(containers+3) - 1
	d := pos - float64(b.ru)
	return math.Round(math.Exp(-(d*d)/0.6)*3) / 3
}

func (c *sctx) tint(b box, sweep bool) (color.RGBA, float64) {
	pal := c.pal
	own := pal.container(b.i)
	lv, age, ok := c.lightOf(b.i)
	on := 0.0
	if ok {
		on = outCubic(age / 0.2)
	}
	col := mix(mix(own, pal.Muted, 0.6), own, on)
	pw := 0.62 + 0.38*on
	if !ok {
		col = pal.Glow(col, 0.4*c.waiting(b))
	} else {
		if lv != OK {
			col = mix(col, pal.level(lv), 0.4)
		}
		if age < 0.45 {
			col = pal.Glow(col, 0.85*math.Pow(1-age/0.45, 2))
		}
	}
	if sweep && !c.reduced && c.t >= snap && c.t < snap+0.45 {
		pos := (c.t-snap)/0.28*11 - 1.5
		d := (float64(b.ru)*2 + 0.5 - pos) / 1.3
		col = pal.Glow(col, math.Exp(-d*d)*0.8)
	}
	return pal.Fade(col, pw), 0.55 + 0.45*pw
}

func (c *sctx) drawLed(cv *scene.Canvas, b box, x, y int, a, idle float64) {
	pal := c.pal
	lv, age, ok := c.lightOf(b.i)
	if !ok {
		wv := c.waiting(b)
		ch := '·'
		if wv > 0.5 {
			ch = '•'
		}
		put(cv, x, y, ch, pal.Fade(pal.Muted, a*(0.45+0.5*wv)), a*(0.3+0.3*wv))
		return
	}
	col := pal.level(lv)
	ch := '●'
	lum := 1.0
	switch {
	case age < 0.09:
		ch = '✦'
		col = pal.Glow(col, 1)
	case age < 0.45:
		col = pal.Glow(col, 0.8*math.Pow(1-(age-0.09)/0.36, 2))
	}
	switch {
	case lv == Warn && !c.reduced && age >= 0.45:
		if math.Mod(age*1.25, 1) > 0.62 {
			ch, lum, col = '○', 0.5, pal.Fade(col, 0.7)
		}
	case lv == Fail && c.noColor:
		ch = '×'
	case lv == OK && idle > 0 && !c.reduced && noise(41, b.i, fl(idle*8)) < 0.07:
		ch, lum, col = '•', 0.6, pal.Fade(col, 0.75)
	}
	putB(cv, x, y, ch, pal.Fade(col, a), lum*a, lum*a >= 0.8)
	if age < 0.2 && !c.reduced {
		s := math.Sin(math.Pi * (age / 0.2))
		put(cv, x+1, y, '─', pal.Fade(col, a*s*0.8), 0.5*s)
	}
}

type dropped struct {
	x, py, w, hp, sk, up int
	vel, f               float64
}

func (c *sctx) drop(L lay, b box) (dropped, bool) {
	t := c.t
	rest := 2*L.T + b.py
	top0 := -6.0
	f := math.Sqrt(2 * (float64(rest) - top0) / grav)
	s := land[b.i] - f
	if t < s {
		return dropped{}, false
	}
	var bottom int
	hp, w, vel := 4, b.w, 0.0
	if t < land[b.i] {
		u := t - s
		bottom = rnd(top0 + 4 + 0.5*grav*u*u)
		vel = grav * u
		if u > 0.7*f {
			hp = 5
		}
	} else {
		q := 1 - spring(t-land[b.i], 32, 0.35)
		bottom = rest + 4
		switch {
		case q > 0.3:
			hp = 3
			w += 2
		case q < -0.15:
			hp = 5
		}
	}
	hu := (t - hop) / (snap - hop)
	up := 0
	if hu >= -0.25 && hu < 0 && w == b.w {
		w += 2
	}
	if hu >= 0 && hu < 1 && math.Sin(math.Pi*hu) > 0.45 {
		up = 2
	}
	if t >= snap && w == b.w && 1-spring(t-snap, 30, 0.4) > 0.3 {
		w += 2
	}
	sk := 0
	if hu < 0.35 {
		sk = b.sk
	}
	return dropped{x: L.lx + b.x - (w-b.w)/2 + sk, py: bottom - hp - up, w: w, hp: hp, vel: vel, f: f, sk: sk, up: up}, true
}

func (c *sctx) dust(cv *scene.Canvas, b box, d dropped, age float64, seed int) {
	pal := c.pal
	dock := b.ru == 0
	life, n := 0.4, 4
	if dock {
		life, n = 0.55, 8
	}
	if age >= life || c.reduced {
		return
	}
	u := age / life
	sy0 := float64(2*(d.py+d.hp) - 1)
	for _, dir := range [2]int{-1, 1} {
		sx0 := float64(2 * (d.x + d.w))
		if dir < 0 {
			sx0 = float64(2*d.x - 1)
		}
		for k := range n {
			r1 := noise(61+seed*7, b.i*16+k, dir+2)
			r2 := noise(62+seed*7, b.i*16+k, dir+2)
			spread, rise := 0.6, 0.7
			if dock {
				spread, rise = 1, 1
			}
			sx := sx0 + float64(dir)*(1+(3+10*r1)*outCubic(u)*spread)
			sy := sy0 - (1+4*r2)*math.Sin(math.Pi*math.Min(u*1.3, 1))*rise
			a := (1 - u*u) * (0.55 + 0.45*r2)
			dot(cv, sx, sy, pal.Fade(pal.Text, a*0.9), a*0.6)
		}
	}
}

func (c *sctx) drawDrop(cv *scene.Canvas, L lay, idle float64) {
	pal, t := c.pal, c.t
	for _, b := range L.bs {
		d, ok := c.drop(L, b)
		if !ok {
			continue
		}
		col, lum := c.tint(b, true)
		DrawContainer(cv, pal.Palette, d.x, d.py, d.w, d.hp, flat(col), lum)
		if d.vel > 0 {
			n := rnd(d.vel / grav / d.f * 7)
			for _, sx := range [2]int{2 * d.x, 2*(d.x+d.w) - 1} {
				for j := 1; j <= n; j++ {
					a := (1 - float64(j)/float64(n+1)) * 0.6
					dot(cv, float64(sx), float64(2*d.py-j*2), pal.Fade(pal.container(b.i), a), a*0.5)
				}
			}
		}
		if t >= land[b.i] {
			c.dust(cv, b, d, t-land[b.i], 0)
		}
		if b.ru == 0 && t >= snap {
			c.dust(cv, b, d, t-snap, 1)
		}
		if t >= land[b.i]-0.05 {
			c.drawLed(cv, b, L.lx+b.ledX+d.sk, L.T+b.ledY-d.up/2, 1, idle)
		}
	}
	for _, b := range L.bs {
		if b.ru != 0 || c.reduced {
			continue
		}
		t0 := land[b.i] - 0.56
		if t <= t0 || t >= land[b.i] {
			continue
		}
		prox := inQuad((t - t0) / 0.56)
		mid := float64(L.lx+b.x+b.sk) + float64(b.w)/2
		hw := float64(b.w) / 2 * (0.25 + 0.75*prox)
		a := 0.25 + 0.55*prox
		for sx := rnd(2 * (mid - hw)); float64(sx) < 2*(mid+hw); sx++ {
			dot(cv, float64(sx), float64(4*(L.G-1)+3), pal.Fade(pal.Muted, a), a*0.5)
		}
	}
}

type wave struct{ pos, amp float64 }

func (c *sctx) front(L lay) *wave {
	age := c.t - snap
	if age < 0 || age > ripple+0.3 {
		return nil
	}
	return &wave{pos: float64(L.HL) * outCubic(age/ripple), amp: 1 - inQuad(age/(ripple+0.3))}
}

func appearAt(L lay, dc int) float64 {
	d := math.Min(math.Abs(float64(L.x0+dc-L.cx))/float64(L.HL), 1)
	return snap + 0.02 + ripple*(1-math.Cbrt(1-d))
}

func (c *sctx) landed(L lay, d float64) float64 {
	v := 0.0
	for _, b := range L.bs {
		age := c.t - land[b.i]
		if age < 0 || age > 0.6 || d < 0 {
			continue
		}
		amp := 0.5
		if b.ru == 0 {
			amp = 1
		}
		z := (d - age*75) / 2.5
		v = math.Max(v, amp*(1-age/0.6)*math.Exp(-z*z))
	}
	return v
}

func (c *sctx) drawDock(cv *scene.Canvas, L lay, p float64) {
	pal, t := c.pal, c.t
	grow := 1.0
	if !c.reduced {
		grow = outQuint((t - 0.06) / 0.6)
	}
	hl := float64(L.HL) * grow * (1 - inOutCubic(p/0.4))
	out := 1 - smooth(p/0.35)
	var fr *wave
	if !c.reduced {
		fr = c.front(L)
	}
	half := float64(L.bx1) / 2
	if hl >= 0.5 {
		for x := int(math.Ceil(float64(L.cx) - hl)); x <= fl(float64(L.cx)+hl); x++ {
			d := math.Abs(float64(x - L.cx))
			under := false
			for _, b := range L.bs {
				if b.ru == 0 && x >= L.lx+b.x-1 && x <= L.lx+b.x+b.w {
					under = true
				}
			}
			e := d / float64(L.HL)
			hue := hueAt(math.Min(math.Max((float64(x-L.x0)+0.5)/float64(L.s)-0.5, 0), float64(theMark.w-1)))
			base := pal.Muted
			if under {
				base = pal.Text
			}
			col := mix(base, pal.Sweep(hue), 0.35)
			a := 0.9 - 0.7*e*e
			if under {
				a = 0.85
			}
			a *= out
			z := (hl - d) / 1.6
			head := math.Exp(-z*z) * (1 - grow)
			band := 0.0
			if !c.reduced {
				band = c.landed(L, d-half)
			}
			if fr != nil {
				z := (d - fr.pos) / 2.2
				band = math.Max(band, fr.amp*math.Exp(-z*z))
			}
			col = pal.Glow(col, math.Max(head, band)*0.9)
			a = math.Min(1, a+head+band*0.5)
			ch, lm := '─', 0.45
			if under {
				ch, lm = '━', 0.7
			}
			put(cv, x, L.G, ch, pal.Fade(col, a), lm*a)
		}
	}
	if !c.reduced && t < 0.36 {
		s := math.Sin(math.Pi * clamp01(t/0.36))
		col := pal.Glow(pal.Sweep(0.1), 0.8)
		putB(cv, L.cx, L.G, '✦', pal.Fade(col, s), s, s > 0.8)
		if s > 0.55 {
			put(cv, L.cx, L.G-1, '│', pal.Fade(pal.Sweep(0.1), s*0.7), 0.5*s)
			put(cv, L.cx, L.G+1, '│', pal.Fade(pal.Sweep(0.1), s*0.7), 0.5*s)
		}
	}
}

func (c *sctx) drawStars(cv *scene.Canvas, L lay, p float64) {
	pal, t := c.pal, c.t
	sky := L.G0 - 1
	n := c.w * sky / 140
	out := 1 - smooth(p/0.25)
	if out <= 0 {
		return
	}
	for k := range n {
		x := fl(noise(53, k, 1) * float64(c.w))
		y := fl(noise(53, k, 2) * float64(sky))
		if x >= L.lx-6 && x <= L.lx+c.scale.width()+2+5 {
			continue
		}
		if y >= L.G-1 {
			continue
		}
		born := 2.3 + noise(53, k, 3)*1.0
		a := out
		if !c.reduced {
			a *= smooth((t - born) / 0.6)
		}
		if a <= 0.02 {
			continue
		}
		rate := 0.12 + noise(53, k, 4)*0.22
		lvl := fl((0.5 + 0.5*math.Sin(2*math.Pi*(noise(53, k, 5)+rate*t))) * 3.999)
		b := [4]float64{0.3, 0.45, 0.62, 0.85}[lvl] * (0.6 + 0.4*noise(53, k, 6))
		ch := '·'
		switch {
		case b > 0.75:
			ch = '✦'
		case b > 0.55:
			ch = '+'
		}
		col := pal.Star
		if noise(53, k, 7) >= 0.6 {
			col = pal.Sweep(noise(53, k, 8))
		}
		put(cv, x, y, ch, pal.tint(col, b*a), b*a*0.8)
	}
}

func cipherColour(pal Palette, a, b, k int, bright float64) (color.RGBA, float64) {
	n := noise(a, b, k+701)
	base := pal.Muted
	if n < 0.42 {
		base = pal.container(int(n*9.5) % 4)
	}
	q := quant(bright, 4)
	return pal.tint(base, q), 0.15 + 0.5*q
}

func lockAt(L lay, c wcell) float64 {
	return math.Max(lock0+lockSpan*c.nx+lockJit*noise(c.dc, c.dr, 3)+0.06*(float64(c.dr)/float64(L.wm.R-1)), appearAt(L, c.dc)+0.16)
}

type glint struct{ x, k float64 }

func (c *sctx) glintAt(L lay) *glint {
	if c.reduced {
		return nil
	}
	span := float64(L.wm.W + 18*L.s)
	s := float64(L.s)
	if c.t >= glintAt0 && c.t < glintAt0+glintLen {
		return &glint{x: -9*s + span*inOutSine((c.t-glintAt0)/glintLen), k: 1}
	}
	tau := c.t - dur - 2.5
	if c.dim > 0 || tau < 0 || c.exit > 0 {
		return nil
	}
	u := math.Mod(tau, 7) / 1.3
	if u < 1 {
		return &glint{x: -9*s + span*inOutSine(u), k: 0.45}
	}
	return nil
}

func (g *glint) on(L lay, dc, dr int) float64 {
	if g == nil {
		return 0
	}
	z := (float64(dc) - g.x - float64(L.wm.R-1-dr)*1.2) / (3.4 * float64(L.s))
	return g.k * math.Exp(-z*z)
}

func hidden(L lay, c wcell) float64 {
	if L.vis >= 1 {
		return 0
	}
	return clamp01((c.th + 0.16 - L.vis) / 0.16)
}

func (c *sctx) drawWord(cv *scene.Canvas, L lay) {
	pal, t := c.pal, c.t
	cells := L.wm.cells
	tau := t - dur
	flick, fa := -1, 0.0
	if !c.reduced && c.dim == 0 && L.vis >= 1 && tau >= 1.2 {
		k := fl((tau - 1.2) / flickEach)
		fa = tau - 1.2 - float64(k)*flickEach
		if fa < 0.34 {
			flick = fl(noise(k, 3, 97) * float64(len(cells)))
		}
	}
	g := c.glintAt(L)
	grey := mix(pal.Faint, pal.Muted, 0.62)
	for i, ce := range cells {
		x, y := L.x0+ce.dc, L.r0+ce.dr
		ta := 0.0
		if !c.reduced {
			ta = appearAt(L, ce.dc)
		}
		if t < ta {
			continue
		}
		hide := hidden(L, ce)
		if hide >= 1 {
			continue
		}
		tl := 0.0
		if !c.reduced {
			tl = lockAt(L, ce)
		}
		if t < tl || hide > 0 || (i == flick && fa < 0.24) {
			var kk int
			var b float64
			switch {
			case hide > 0:
				kk = fl(17*t + ce.n*5)
				b = 0.65 * (1 - hide)
			case i == flick && t >= tl:
				kk = fl(fa * 14)
				b = 0.55
			default:
				slow := math.Max(0, 0.3-(tl-t))
				kk = fl(17*t - 18*slow*slow + noise(ce.dc, ce.dr, 9)*5)
				fresh := math.Exp(-(t - ta) / 0.14)
				heat := smooth((t - tl + 0.28) / 0.28)
				b = 0.3 + 0.6*fresh + 0.3*heat + 0.15*noise(ce.dc, ce.dr, kk)
			}
			col, lum := cipherColour(pal, ce.dc, ce.dr, kk, b)
			put(cv, x, y, cipherGlyph(ce.dc+131*kk, ce.dr, 13), col, lum)
			continue
		}
		col := pal.Sweep(ce.hue)
		lum := 0.9
		ch := ce.glyph
		a := t - tl
		if i == flick {
			a = fa - 0.24
		}
		u := a - 0.12 - 0.12*(1-float64(ce.dr)/float64(L.wm.R-1))
		if !c.reduced && i != flick && u < 0.3 {
			k := 0.0
			if u >= 0 {
				k = outCubic(u / 0.12)
			}
			col = mix(grey, col, k)
			if u >= 0 {
				col = pal.Glow(col, 0.6*math.Exp(-u/0.08))
			}
			lum = 0.6 + 0.3*k
		}
		if !c.reduced && a < 0.4 {
			f := math.Exp(-a / 0.07)
			if a < 1.0/FPS {
				ch = '█'
			}
			col = pal.Glow(col, f)
			lum += (1 - lum) * f
		}
		if gv := g.on(L, ce.dc, ce.dr); gv > 0.02 {
			col = pal.Glow(col, gv)
			lum = math.Max(lum, 0.55+0.45*gv)
			if c.noColor && gv > 0.5 && ch == '█' {
				ch = '▓'
			}
		}
		put(cv, x, y, ch, col, lum)
	}
	if !c.reduced && t < snap+ripple+0.5 {
		for _, gh := range L.wm.ghosts {
			age := t - appearAt(L, gh.dc)
			if age < 0 || age > gh.life {
				continue
			}
			kk := fl(t*16 + float64(gh.dc))
			col, lum := cipherColour(pal, gh.dc, gh.dr, kk, 0.75*(1-age/gh.life))
			put(cv, L.x0+gh.dc, L.r0+gh.dr, cipherGlyph(gh.dc+17*kk, gh.dr, 14), col, lum)
		}
	}
}

func (c *sctx) scene(cv *scene.Canvas) {
	L := c.layout()
	p := c.exit
	c.drawStars(cv, L, p)
	c.drawDock(cv, L, p)
	if p <= 0 {
		c.drawDrop(cv, L, math.Max(0, c.t-dur))
		c.drawWord(cv, L)
		return
	}
	c.wordOut(cv, L, p)
	if c.target.Emblem != nil {
		c.exitToEmblem(cv, L, p)
	} else {
		c.exitToDiamond(cv, L, p)
	}
	c.drawTitle(cv, p)
}

func (c *sctx) clipScene(cv *scene.Canvas) {
	cv.Clear(0, c.w, c.h-1)
	if r := c.cardRect; r != nil {
		for y := max(r.y0-1, 0); y < min(r.y1, c.h); y++ {
			cv.Clear(r.x0-2, r.x1+2, y)
		}
	}
}

func (c *sctx) dimScene(cv *scene.Canvas) {
	if c.dim <= 0 {
		return
	}
	k := 0.65 * c.dim
	for i, ce := range cv.Cells {
		if ce.R == 0 || ce.R == ' ' {
			continue
		}
		cv.Cells[i].FG = c.pal.Fade(ce.FG, 1-k)
		cv.Cells[i].Lum = ce.Lum * (1 - k)
	}
}
