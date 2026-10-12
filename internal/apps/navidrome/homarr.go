package navidrome

import (
	"context"
	"crypto/md5"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/ajnart/self-host/internal/helpers"
)

type HomarrData struct {
	ArtistCount int
	AlbumCount  int
	SongCount   int
	Sessions    int
}

type subsonicResponse struct {
	Status        string `json:"status"`
	Version       string `json:"version"`
	Type          string `json:"type"`
	ServerVersion string `json:"serverVersion"`
	Error         *struct {
		Code    int    `json:"code"`
		Message string `json:"message"`
	} `json:"error"`
	MusicFolders *struct {
		Folders []struct {
			ID   *int   `json:"id"`
			Name string `json:"name"`
		} `json:"musicFolder"`
	} `json:"musicFolders"`
	ScanStatus *struct {
		Scanning *bool  `json:"scanning"`
		Count    *int   `json:"count"`
		LastScan string `json:"lastScan"`
		Error    string `json:"error"`
	} `json:"scanStatus"`
	Artists *struct {
		Index []struct {
			Artist []struct {
				ID   string `json:"id"`
				Name string `json:"name"`
			} `json:"artist"`
		} `json:"index"`
	} `json:"artists"`
	AlbumList *struct {
		Albums []struct {
			ID        string `json:"id"`
			Name      string `json:"name"`
			SongCount *int   `json:"songCount"`
		} `json:"album"`
	} `json:"albumList2"`
	NowPlaying *struct {
		Entries []struct {
			ID       string `json:"id"`
			Title    string `json:"title"`
			Username string `json:"username"`
		} `json:"entry"`
	} `json:"nowPlaying"`
}

func subsonicRequest(ctx context.Context, h *helpers.H, endpoint string, params url.Values) (*subsonicResponse, helpers.Response, error) {
	if h.AdminUser() == "" || h.AdminPassword() == "" {
		return nil, helpers.Response{}, errors.New("Navidrome Admin login is missing; run self-host setup navidrome")
	}
	if params == nil {
		params = url.Values{}
	}
	var randomSalt [16]byte
	if _, err := rand.Read(randomSalt[:]); err != nil {
		return nil, helpers.Response{}, errors.New("cannot prepare Navidrome authentication")
	}
	salt := hex.EncodeToString(randomSalt[:])
	token := fmt.Sprintf("%x", md5.Sum([]byte(h.AdminPassword()+salt)))
	h.Log.Secret(token)
	params.Set("u", h.AdminUser())
	params.Set("t", token)
	params.Set("s", salt)
	params.Set("v", "1.16.1")
	params.Set("c", "self-host")
	params.Set("f", "json")
	resp, err := h.HTTP(ctx, helpers.Request{
		Method: http.MethodPost, Path: "/rest/" + endpoint + ".view",
		Form: params, NoRedirect: true,
	})
	if err != nil {
		if ctx.Err() != nil {
			return nil, resp, ctx.Err()
		}
		return nil, resp, fmt.Errorf("Navidrome %s request failed; retry self-host setup navidrome", endpoint)
	}
	if resp.Status != http.StatusOK {
		return nil, resp, fmt.Errorf("Navidrome %s returned HTTP %d; retry self-host setup navidrome", endpoint, resp.Status)
	}
	var envelope struct {
		Response *subsonicResponse `json:"subsonic-response"`
	}
	if resp.Decode(&envelope) != nil || envelope.Response == nil {
		return nil, resp, errors.New("Navidrome returned an invalid Subsonic response")
	}
	value := envelope.Response
	version, _, _ := strings.Cut(value.ServerVersion, " ")
	if value.Version != "1.16.1" || value.Type != "navidrome" || version != "0.64.0" {
		return nil, resp, errors.New("Navidrome API compatibility is unverified; use Navidrome 0.64.0 and retry Setup")
	}
	if value.Status == "failed" {
		if endpoint == "getArtists" && value.Error != nil && value.Error.Code == 70 && value.Error.Message == "Library not found or empty" {
			return value, resp, nil
		}
		return nil, resp, fmt.Errorf("Navidrome rejected %s; check the saved Admin login and Subsonic access, then run self-host setup navidrome", endpoint)
	}
	if value.Status != "ok" || value.Error != nil {
		return nil, resp, errors.New("Navidrome did not confirm Subsonic success")
	}
	return value, resp, nil
}

func ReadHomarrData(ctx context.Context, h *helpers.H) (HomarrData, error) {
	return readMusicData(ctx, h, 10000)
}

func readMusicData(ctx context.Context, h *helpers.H, albumLimit int) (HomarrData, error) {
	ctx, cancel := context.WithTimeout(ctx, time.Minute)
	defer cancel()
	data := HomarrData{}
	if _, _, err := subsonicRequest(ctx, h, "ping", nil); err != nil {
		return data, err
	}
	folders, _, err := subsonicRequest(ctx, h, "getMusicFolders", nil)
	if err != nil {
		return data, err
	}
	if folders.MusicFolders == nil || len(folders.MusicFolders.Folders) == 0 {
		return data, errors.New("Navidrome has no accessible music library; review library access, then retry Setup")
	}
	for _, folder := range folders.MusicFolders.Folders {
		if folder.ID == nil || *folder.ID <= 0 || folder.Name == "" {
			return data, errors.New("Navidrome returned incomplete music library data")
		}
	}
	scan, _, err := subsonicRequest(ctx, h, "getScanStatus", nil)
	if err != nil {
		return data, err
	}
	if scan.ScanStatus == nil || scan.ScanStatus.Scanning == nil || scan.ScanStatus.Count == nil || *scan.ScanStatus.Count < 0 {
		return data, errors.New("Navidrome returned incomplete library scan data")
	}
	lastScan, err := time.Parse(time.RFC3339, scan.ScanStatus.LastScan)
	if err != nil || lastScan.IsZero() || *scan.ScanStatus.Scanning || scan.ScanStatus.Error != "" {
		return data, errors.New("Navidrome library scan is unfinished or failed; review its music folder and logs, then run self-host setup navidrome")
	}
	if err := readAlbums(ctx, h, &data, albumLimit); err != nil {
		return data, err
	}
	artists, _, err := subsonicRequest(ctx, h, "getArtists", nil)
	if err != nil {
		return data, err
	}
	if artists.Status == "failed" {
		if data.AlbumCount != 0 || *scan.ScanStatus.Count != 0 {
			return data, errors.New("Navidrome artist data is unavailable for a nonempty library")
		}
	} else {
		if artists.Artists == nil || len(artists.Artists.Index) == 0 {
			return data, errors.New("Navidrome returned incomplete artist data")
		}
		for _, index := range artists.Artists.Index {
			if len(index.Artist) == 0 {
				return data, errors.New("Navidrome returned an incomplete artist index")
			}
			for _, artist := range index.Artist {
				if artist.ID == "" || artist.Name == "" {
					return data, errors.New("Navidrome returned incomplete artist data")
				}
				data.ArtistCount++
			}
		}
	}
	nowPlaying, _, err := subsonicRequest(ctx, h, "getNowPlaying", nil)
	if err != nil {
		return data, err
	}
	if nowPlaying.NowPlaying == nil {
		return data, errors.New("Navidrome did not return its listening sessions")
	}
	for _, entry := range nowPlaying.NowPlaying.Entries {
		if entry.ID == "" || entry.Title == "" || entry.Username == "" {
			return data, errors.New("Navidrome returned incomplete listening session data")
		}
	}
	data.Sessions = len(nowPlaying.NowPlaying.Entries)
	return data, nil
}

func readAlbums(ctx context.Context, h *helpers.H, data *HomarrData, albumLimit int) error {
	total := -1
	seen := map[string]bool{}
	for page := 0; ; page++ {
		albums, resp, err := subsonicRequest(ctx, h, "getAlbumList2", url.Values{
			"type": {"alphabeticalByName"}, "size": {"500"}, "offset": {strconv.Itoa(page * 500)},
		})
		if err != nil {
			return err
		}
		count, err := strconv.Atoi(resp.Header.Get("X-Total-Count"))
		if err != nil || count < 0 || albums.AlbumList == nil || total >= 0 && total != count {
			return errors.New("Navidrome returned incomplete or changing album counts; retry Setup after scanning finishes")
		}
		if albumLimit > 0 && count > albumLimit {
			return errors.New("Navidrome exceeds Homarr 2.4.1's 10000-album limit; complete library counts cannot be verified")
		}
		total = count
		for _, album := range albums.AlbumList.Albums {
			if album.ID == "" || album.Name == "" || album.SongCount == nil || *album.SongCount < 0 || seen[album.ID] {
				return errors.New("Navidrome returned incomplete or repeated album data")
			}
			seen[album.ID] = true
			data.AlbumCount++
			data.SongCount += *album.SongCount
		}
		if data.AlbumCount == total {
			return nil
		}
		if len(albums.AlbumList.Albums) != 500 || data.AlbumCount > total {
			return errors.New("Navidrome album data does not match its explicit total count")
		}
	}
}

func verifyMusicAPI(ctx context.Context, h *helpers.H) error {
	_, err := readMusicData(ctx, h, 0)
	return err
}
