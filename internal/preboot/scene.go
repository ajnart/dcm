package preboot

import (
	"image/color"

	"github.com/ajnart/self-host/internal/scene"
)

// Palette is the pre-boot screen's own set of colours: it is the one screen
// that may use several.
type Palette = scene.Palette

// Dark is the palette for a dark terminal.
func Dark() Palette { return scene.Dark() }

// Light is the palette for a light terminal.
func Light() Palette { return scene.Light() }

type (
	cell   = scene.Cell
	canvas = scene.Canvas
)

func newCanvas(w, h int) *canvas { return scene.New(w, h) }

func lerp(a, b color.RGBA, t float64) color.RGBA { return scene.Lerp(a, b, t) }
func smooth(x float64) float64                   { return scene.Smooth(x) }
func clamp01(x float64) float64                  { return scene.Clamp01(x) }
func abs(x int) int                              { return scene.Abs(x) }
func hash(a, b, c int) uint32                    { return scene.Hash(a, b, c) }
func noise(a, b, c int) float64                  { return scene.Noise(a, b, c) }
