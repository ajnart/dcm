package homarr

func paperlessTarget() target {
	return target{
		id: "paperless-ngx", name: "Paperless-ngx", kind: "paperlessNgx",
		internal: fixed("http://paperless-ngx:8000"), secrets: apiKeySecret,
		widgets: []widget{{kind: "paperlessNgx", options: map[string]any{
			"showInboxRatio": true, "showInboxRing": true,
			"showDocumentsTotal": true, "showDocumentsInbox": true,
			"showCorrespondents": true, "showTags": true, "showDocumentTypes": true,
		}}},
	}
}
