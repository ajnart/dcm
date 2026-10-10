//go:build e2e

package e2e

func (r *runner) requireLocalResources() {
	obs := r.guard.localResourceBlocker()
	if obs == nil {
		measured := measureLocalAdmission(r.root, r.minimumDiskBytes, ownedFilesystemCapacity)
		obs = &measured
		if obs.Reason == "" {
			return
		}
		r.guard.blockLocalResources(*obs)
	}
	owner := r
	if owner.evidence == nil && r.evidenceOwner != nil {
		owner = r.evidenceOwner
	}
	if owner.evidence != nil {
		markResourceBlocked(owner.evidence, obs)
		owner.saveEvidence()
	}
	r.t.Skip(obs.Reason + "; new mutations stopped, owned cleanup remains enabled")
}
