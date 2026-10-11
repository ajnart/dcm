package homarr

import "github.com/ajnart/self-host/internal/helpers"

func aria2Target() target {
	return target{
		id: "aria2", name: "Aria2", kind: "aria2", internal: fixed("http://aria2:6800"),
		secrets: func(_, to *helpers.H) []secret {
			return []secret{{Kind: "apiKey", Value: to.Secret(to.Key("rpc_token"))}}
		},
		widgets: []widget{plain("downloads"), statWidget("download", "upload", "paused")},
	}
}
