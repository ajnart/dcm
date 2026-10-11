package homarr

func audiobookshelfTarget() target {
	return target{
		id: "audiobookshelf", name: "Audiobookshelf", kind: "audiobookshelf",
		internal: fixed("http://audiobookshelf:80"), secrets: apiKeySecret,
		widgets: []widget{{
			kind: "audioStats",
			options: map[string]any{
				"showLibraryCount": true, "showAudiobooks": true, "showPodcasts": true,
				"showListeningTime": false, "showActiveSessions": true, "compactMode": false,
				"showArtists": false, "showAlbums": false, "showSongs": false,
			},
		}},
	}
}
