package homarr

func targets() []target {
	return append(existingTargets(), immichTarget(), caddyTarget(), gatusTarget(), prometheusTarget(), gotifyTarget(), technitiumDNSTarget(), dashdotTarget(), glancesTarget(), netdataTarget(), traefikTarget(), audiobookshelfTarget(), paperlessTarget(), linkwardenTarget())
}
