package homarr

import "github.com/ajnart/self-host/internal/helpers"

func adguardTarget() target {
	return target{
		id: "adguard-home", name: "AdGuard Home", kind: "adGuardHome",
		internal: fixed("http://adguard-home:3000"),
		secrets: func(_, to *helpers.H) []secret {
			return []secret{{Kind: "username", Value: to.AdminUser()}, {Kind: "password", Value: to.AdminPassword()}}
		},
		widgets: []widget{
			plain("dnsHoleSummary"),
			{kind: "dnsHoleControls", options: map[string]any{"showToggleAllButtons": false}},
			statWidget("dnsQueriesToday", "adsBlockedToday", "domainsBeingBlocked"),
		},
	}
}
