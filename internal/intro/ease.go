package intro

import "math"

func inQuad(x float64) float64   { x = clamp01(x); return x * x }
func outQuad(x float64) float64  { x = clamp01(x); return 1 - (1-x)*(1-x) }
func inCubic(x float64) float64  { x = clamp01(x); return x * x * x }
func outCubic(x float64) float64 { x = 1 - clamp01(x); return 1 - x*x*x }
func inOutCubic(x float64) float64 {
	x = clamp01(x)
	if x < 0.5 {
		return 4 * x * x * x
	}
	return 1 - math.Pow(-2*x+2, 3)/2
}
func outQuint(x float64) float64 { return 1 - math.Pow(1-clamp01(x), 5) }
func inOutSine(x float64) float64 {
	return -(math.Cos(math.Pi*clamp01(x)) - 1) / 2
}

func spring(t, omega, zeta float64) float64 {
	if t <= 0 {
		return 0
	}
	if zeta >= 1 {
		return 1 - math.Exp(-omega*t)*(1+omega*t)
	}
	wd := omega * math.Sqrt(1-zeta*zeta)
	return 1 - math.Exp(-zeta*omega*t)*(math.Cos(wd*t)+(zeta*omega/wd)*math.Sin(wd*t))
}

func lerpf(a, b, u float64) float64 { return a + (b-a)*u }

func rnd(x float64) int { return int(math.Floor(x + 0.5)) }

func fl(x float64) int { return int(math.Floor(x)) }

func quant(k float64, n float64) float64 { return math.Round(clamp01(k)*n) / n }
