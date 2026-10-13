package homarr

func targets() []target {
	return append(existingTargets(), immichTarget(), aria2Target())
}
