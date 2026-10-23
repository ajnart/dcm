//go:build e2e

package e2e

func (r *runner) measureAdmission(measure func(string) (filesystemCapacity, error)) resourceEvidence {
	return measureAdmission(r.storageRoot, r.root, r.minimumDiskBytes, r.minimumExecutableBytes, measure)
}

func (r *runner) requireLocalResources() {
	owner := r
	if owner.evidence == nil && r.evidenceOwner != nil {
		owner = r.evidenceOwner
	}
	obs := r.guard.localResourceBlocker()
	if obs == nil {
		measured := r.measureAdmission(ownedFilesystemCapacity)
		obs = &measured
		if owner.evidence != nil {
			owner.evidence.Resources = obs
		}
		if obs.Reason == "" {
			return
		}
		r.guard.blockLocalResources(*obs)
	}
	if owner.evidence != nil {
		markResourceBlocked(owner.evidence, obs)
		owner.saveEvidence()
	}
	r.t.Skip(obs.Reason + "; new mutations stopped, owned cleanup remains enabled")
}
