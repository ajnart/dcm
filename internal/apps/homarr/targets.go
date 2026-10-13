package homarr

func targets() []target {
	return append(existingTargets(), immichTarget(), netdataTarget())
}
