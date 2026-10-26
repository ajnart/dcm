package speedtesttracker

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/http"
	"slices"
	"strconv"
	"time"

	"github.com/ajnart/self-host/internal/helpers"
)

const tokenHint = "Run self-host setup speedtest-tracker to prepare its owned Read Results token. If its value is lost or rejected, restore the recorded credential through the Project secret boundary; never adopt a matching manual token. Review collisions or ambiguous issuance at /admin/api-tokens using the Admin login from self-host credentials. Only after an explicit ownership decision, remove the recorded owned token if necessary and clear HOMARR_API_KEY, HOMARR_API_KEY_ID and HOMARR_TOKEN_PENDING under the SPEEDTEST_TRACKER_ prefix through the Project secret boundary, then retry Setup. Do not reset accounts or enable Run Speedtest or List servers."

const homarrTokenName = "self-host Homarr results"

const homarrRuntime = `require '/app/www/vendor/autoload.php';
$app=require '/app/www/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
if (!class_exists(Laravel\Sanctum\PersonalAccessToken::class) || !method_exists(App\Models\User::class,'createToken')) exit(30);
$u=App\Models\User::where('email',getenv('SELFHOST_ADMIN_EMAIL'))->first();
if (!$u || !$u->is_admin || !Illuminate\Support\Facades\Hash::check(getenv('SELFHOST_ADMIN_PASSWORD'),$u->password)) exit(21);
$expected=getenv('SELFHOST_HOMARR_ADMIN_ID');
if ($expected && (string)$u->getKey()!==$expected) exit(22);
`

const verifyHomarrTokenScript = homarrRuntime + `$token=Laravel\Sanctum\PersonalAccessToken::findToken(getenv('SELFHOST_HOMARR_API_KEY'));
if (!$token || (string)$token->getKey()!==getenv('SELFHOST_HOMARR_TOKEN_ID')) exit(23);
$owner=$token->tokenable;
if (!($owner instanceof App\Models\User) || (string)$owner->getKey()!==(string)$u->getKey()) exit(24);
if ($token->name!=='self-host Homarr results' || $token->abilities!==['results:read']) exit(25);
if ($token->expires_at && $token->expires_at->isPast()) exit(26);
echo json_encode(['id'=>(string)$token->getKey(),'adminId'=>(string)$u->getKey(),'name'=>$token->name,'abilities'=>$token->abilities],JSON_THROW_ON_ERROR);
`

const createHomarrTokenScript = homarrRuntime + `if ($u->tokens()->where('name','self-host Homarr results')->exists()) exit(27);
if (getenv('SELFHOST_HOMARR_API_KEY') || getenv('SELFHOST_HOMARR_TOKEN_ID')) exit(28);
$created=$u->createToken('self-host Homarr results',['results:read']);
echo json_encode(['id'=>(string)$created->accessToken->getKey(),'adminId'=>(string)$u->getKey(),'name'=>$created->accessToken->name,'abilities'=>$created->accessToken->abilities,'key'=>$created->plainTextToken],JSON_THROW_ON_ERROR);
`

const measurementHint = "No usable completed Speedtest Tracker measurement is available. Internet speed is unknown, not zero. A real test consumes external bandwidth and may require provider terms; obtain separate approval bounded to one lawful supported test before running it outside Setup. After a completed result exists, run self-host setup speedtest-tracker and self-host setup homarr. Setup never runs or schedules a test."

var errNoMeasurement = errors.New("no completed measurement")

type Result struct {
	ID           *int64          `json:"id"`
	Ping         *float64        `json:"ping"`
	DownloadBits *float64        `json:"download_bits"`
	UploadBits   *float64        `json:"upload_bits"`
	Healthy      json.RawMessage `json:"healthy"`
	CreatedAt    string          `json:"created_at"`
	Status       string          `json:"status"`
	Download     *float64        `json:"download"`
	Upload       *float64        `json:"upload"`
}

func (r *Result) UnmarshalJSON(raw []byte) error {
	type result Result
	var value result
	if err := json.Unmarshal(raw, &value); err != nil {
		return err
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(raw, &fields); err != nil {
		return err
	}
	if _, present := fields["ping"]; !present {
		return errors.New("Speedtest Tracker result omitted its ping field")
	}
	*r = Result(value)
	return nil
}

type Statistic struct {
	Average     *float64 `json:"avg"`
	AverageBits *float64 `json:"avg_bits"`
	Minimum     *float64 `json:"min"`
	Maximum     *float64 `json:"max"`
}

type Statistics struct {
	Ping         *Statistic `json:"ping"`
	Download     *Statistic `json:"download"`
	Upload       *Statistic `json:"upload"`
	TotalResults *int64     `json:"total_results"`
}

type HomarrData struct {
	LatestResult  *Result     `json:"latestResult"`
	Stats         *Statistics `json:"stats"`
	RecentResults []Result    `json:"recentResults"`
}

type resultCollection struct {
	Data []Result `json:"data"`
	Meta *struct {
		CurrentPage *int64 `json:"current_page"`
		LastPage    *int64 `json:"last_page"`
		Total       *int64 `json:"total"`
	} `json:"meta"`
}

type homarrToken struct {
	ID        string   `json:"id"`
	AdminID   string   `json:"adminId"`
	Name      string   `json:"name"`
	Abilities []string `json:"abilities"`
	Key       string   `json:"key"`
}

func ownedTokenMetadata(token homarrToken) bool {
	id, idErr := strconv.ParseUint(token.ID, 10, 64)
	adminID, adminErr := strconv.ParseUint(token.AdminID, 10, 64)
	return idErr == nil && adminErr == nil && id > 0 && adminID > 0 && token.Name == homarrTokenName && slices.Equal(token.Abilities, []string{"results:read"})
}

func tokenEnvironment(h *helpers.H) map[string]string {
	return map[string]string{
		"SELFHOST_ADMIN_EMAIL":     adminEmail(h),
		"SELFHOST_ADMIN_PASSWORD":  h.AdminPassword(),
		"SELFHOST_HOMARR_ADMIN_ID": h.Secret(h.Key("homarr_admin_id")),
		"SELFHOST_HOMARR_TOKEN_ID": h.Secret(h.Key("homarr_api_key_id")),
		"SELFHOST_HOMARR_API_KEY":  h.Secret(h.Key("homarr_api_key")),
	}
}

func tokenManual(h *helpers.H, reason string) error {
	h.Info(reason + " " + tokenHint)
	return fmt.Errorf("%w: %s", helpers.ErrManual, reason)
}

func verifyHomarrToken(ctx context.Context, h *helpers.H) error {
	if h.Secret(h.Key("homarr_token_pending")) != "" {
		return tokenManual(h, "Speedtest Tracker token issuance needs an explicit recovery decision; no second token will be created.")
	}
	key := h.Secret(h.Key("homarr_api_key"))
	id := h.Secret(h.Key("homarr_api_key_id"))
	adminID := h.Secret(h.Key("homarr_admin_id"))
	if key == "" || id == "" || adminID == "" {
		return tokenManual(h, "Speedtest Tracker's recorded token value or ownership is missing; no existing token will be adopted.")
	}
	if h.Config.Exec == nil {
		return tokenManual(h, "Speedtest Tracker's owned runtime is unavailable for token ownership and scope verification.")
	}
	result, err := h.Exec(ctx, tokenEnvironment(h), "s6-setuidgid", "abc", "php", "-r", verifyHomarrTokenScript)
	if err != nil || result.ExitCode != 0 {
		return tokenManual(h, "Speedtest Tracker could not verify its recorded administrator, token identity, exact results:read scope or expiry.")
	}
	var token homarrToken
	if json.Unmarshal(result.Stdout, &token) != nil || !ownedTokenMetadata(token) || token.ID != id || token.AdminID != adminID {
		return tokenManual(h, "Speedtest Tracker did not return verified owned read-only token metadata.")
	}
	return nil
}

func createHomarrKey(ctx context.Context, h *helpers.H) error {
	if h.Secret(h.Key("homarr_api_key")) != "" || h.Secret(h.Key("homarr_api_key_id")) != "" || h.Secret(h.Key("homarr_token_pending")) != "" {
		if err := verifyHomarrToken(ctx, h); err != nil {
			return err
		}
		_, err := readHistory(ctx, h)
		return err
	}
	if h.Config.Exec == nil {
		return tokenManual(h, "Speedtest Tracker's owned runtime is unavailable for supported Sanctum token creation.")
	}
	if err := h.SetSecret(h.Key("homarr_token_pending"), "true"); err != nil {
		return err
	}
	result, err := h.Exec(ctx, tokenEnvironment(h), "s6-setuidgid", "abc", "php", "-r", createHomarrTokenScript)
	if err != nil || result.ExitCode != 0 {
		return tokenManual(h, "Speedtest Tracker token creation was blocked by account verification, a token collision or an ambiguous runtime result; inspect it before retrying.")
	}
	var token homarrToken
	if json.Unmarshal(result.Stdout, &token) != nil || !ownedTokenMetadata(token) || token.Key == "" {
		return tokenManual(h, "Speedtest Tracker token creation did not return its one-time value and owned identity; no automatic retry will issue another token.")
	}
	h.Log.Secret(token.Key)
	if expected := h.Secret(h.Key("homarr_admin_id")); expected != "" && token.AdminID != expected {
		return tokenManual(h, "Speedtest Tracker token creation did not preserve its recorded administrator identity.")
	}
	for _, item := range []struct{ name, value string }{
		{"homarr_admin_id", token.AdminID},
		{"homarr_api_key_id", token.ID},
		{"homarr_api_key", token.Key},
	} {
		if err := h.SetSecret(h.Key(item.name), item.value); err != nil {
			return err
		}
	}
	return h.SetSecret(h.Key("homarr_token_pending"), "")
}

func resultsRequest(ctx context.Context, h *helpers.H, path string) (helpers.Response, error) {
	key := h.Secret(h.Key("homarr_api_key"))
	if key == "" {
		return helpers.Response{}, fmt.Errorf("%w: %s", helpers.ErrManual, tokenHint)
	}
	h.Log.Secret(key)
	response, err := h.HTTP(ctx, helpers.Request{
		Path: path, NoRedirect: true,
		Header: map[string]string{"Authorization": "Bearer " + key},
	})
	if err != nil {
		return response, errors.New("Speedtest Tracker results transport failed; run self-host debug speedtest-tracker")
	}
	if response.Status == http.StatusUnauthorized || response.Status == http.StatusForbidden {
		return response, fmt.Errorf("%w: Speedtest Tracker rejected its saved read credential. %s", helpers.ErrManual, tokenHint)
	}
	return response, nil
}

func readHistory(ctx context.Context, h *helpers.H) (resultCollection, error) {
	var history resultCollection
	response, err := resultsRequest(ctx, h, "/api/v1/results?result_count=30&sort=-created_at")
	if err != nil {
		return history, err
	}
	if response.Status != http.StatusOK {
		return history, fmt.Errorf("Speedtest Tracker result history returned HTTP %d; retry self-host setup speedtest-tracker", response.Status)
	}
	if response.Decode(&history) != nil || history.Data == nil || history.Meta == nil || history.Meta.Total == nil || history.Meta.CurrentPage == nil || history.Meta.LastPage == nil || *history.Meta.Total < 0 || *history.Meta.CurrentPage != 1 || *history.Meta.LastPage < 1 || *history.Meta.Total < int64(len(history.Data)) || (*history.Meta.Total == 0) != (len(history.Data) == 0) {
		return history, errors.New("Speedtest Tracker returned incomplete result history; retry self-host setup speedtest-tracker")
	}
	seen := map[int64]bool{}
	previous := time.Time{}
	for _, result := range history.Data {
		if err := result.Validate(); err != nil {
			return history, err
		}
		if result.Status == "completed" && !result.conversionCurrent() {
			return history, errors.New("Speedtest Tracker completed history is missing measurement fields or has inconsistent byte/bit rates; use the supported version and retry self-host setup speedtest-tracker")
		}
		created, _ := result.Timestamp(time.UTC)
		if seen[*result.ID] || !previous.IsZero() && created.After(previous) {
			return history, errors.New("Speedtest Tracker result history is not uniquely ordered newest first; retry Setup")
		}
		seen[*result.ID] = true
		previous = created
	}
	return history, nil
}

func homarrKeyWorks(ctx context.Context, h *helpers.H) (bool, error) {
	if h.Secret(h.Key("homarr_api_key")) == "" && h.Secret(h.Key("homarr_api_key_id")) == "" && h.Secret(h.Key("homarr_token_pending")) == "" {
		return false, nil
	}
	if err := verifyHomarrToken(ctx, h); err != nil {
		return false, err
	}
	_, err := readHistory(ctx, h)
	return err == nil, err
}

func ReadHomarr(ctx context.Context, h *helpers.H) (HomarrData, error) {
	var data HomarrData
	if err := verifyHomarrToken(ctx, h); err != nil {
		return data, err
	}
	history, err := readHistory(ctx, h)
	if err != nil {
		return data, err
	}
	response, err := resultsRequest(ctx, h, "/api/v1/results/latest")
	if err != nil {
		return data, err
	}
	if response.Status == http.StatusNotFound && *history.Meta.Total == 0 {
		return data, fmt.Errorf("%w: %w: %s", errNoMeasurement, helpers.ErrManual, measurementHint)
	}
	if response.Status != http.StatusOK {
		return data, fmt.Errorf("Speedtest Tracker latest result returned HTTP %d; retry self-host setup speedtest-tracker", response.Status)
	}
	var latest struct {
		Data *Result `json:"data"`
	}
	if response.Decode(&latest) != nil || latest.Data == nil {
		return data, errors.New("Speedtest Tracker did not return its latest result; retry Setup")
	}
	if err := latest.Data.Validate(); err != nil {
		return data, err
	}
	if latest.Data.Status != "completed" || !latest.Data.Measured() {
		return data, fmt.Errorf("%w: %w: %s", errNoMeasurement, helpers.ErrManual, measurementHint)
	}
	if !latest.Data.conversionCurrent() {
		return data, errors.New("Speedtest Tracker result byte/bit rate fields disagree; use the supported version and retry Setup")
	}
	if len(history.Data) == 0 || history.Data[0].CreatedAt != latest.Data.CreatedAt || !history.Data[0].SameMeasurement(*latest.Data) {
		return data, errors.New("Speedtest Tracker latest result does not match its fresh history; wait for any active test to finish and retry Setup")
	}
	response, err = resultsRequest(ctx, h, "/api/v1/stats")
	if err != nil {
		return data, err
	}
	if response.Status != http.StatusOK {
		return data, fmt.Errorf("Speedtest Tracker statistics returned HTTP %d; retry Setup", response.Status)
	}
	var stats struct {
		Data *Statistics `json:"data"`
	}
	if response.Decode(&stats) != nil || stats.Data == nil || stats.Data.Validate() != nil || *stats.Data.TotalResults != *history.Meta.Total {
		return data, errors.New("Speedtest Tracker returned incomplete or changing statistics; wait for any active test to finish and retry Setup")
	}
	return HomarrData{LatestResult: latest.Data, Stats: stats.Data, RecentResults: history.Data}, nil
}

func nonnegative(value *float64) bool {
	return value != nil && !math.IsNaN(*value) && !math.IsInf(*value, 0) && *value >= 0
}

func (r Result) Validate() error {
	_, err := r.Timestamp(time.UTC)
	if r.ID == nil || *r.ID <= 0 || err != nil || len(r.Healthy) == 0 {
		return errors.New("Speedtest Tracker returned incomplete result identity, timestamp or health; retry Setup")
	}
	var healthy *bool
	if json.Unmarshal(r.Healthy, &healthy) != nil {
		return errors.New("Speedtest Tracker returned an invalid result health field; retry Setup")
	}
	for _, value := range []*float64{r.Ping, r.DownloadBits, r.UploadBits} {
		if value != nil && !nonnegative(value) {
			return errors.New("Speedtest Tracker returned invalid measurement values; retry Setup")
		}
	}
	for _, value := range []*float64{r.DownloadBits, r.UploadBits} {
		if value != nil && math.Trunc(*value) != *value {
			return errors.New("Speedtest Tracker returned non-integral bit rates; use the supported version and retry Setup")
		}
	}
	return nil
}

func (r Result) Timestamp(location *time.Location) (time.Time, error) {
	created, err := time.ParseInLocation("2006-01-02 15:04:05", r.CreatedAt, location)
	if err != nil {
		return time.Parse(time.RFC3339Nano, r.CreatedAt)
	}
	return created, nil
}

func (r Result) Measured() bool {
	return nonnegative(r.Ping) && nonnegative(r.DownloadBits) && nonnegative(r.UploadBits)
}

func (r Result) conversionCurrent() bool {
	return nonnegative(r.Download) && nonnegative(r.Upload) && r.Measured() && math.Round(*r.Download*8) == *r.DownloadBits && math.Round(*r.Upload*8) == *r.UploadBits
}

func (r Result) SameMeasurement(other Result) bool {
	return r.ID != nil && other.ID != nil && r.Measured() && other.Measured() && *r.ID == *other.ID && *r.Ping == *other.Ping && *r.DownloadBits == *other.DownloadBits && *r.UploadBits == *other.UploadBits && string(r.Healthy) == string(other.Healthy)
}

func (s Statistics) Validate() error {
	if s.TotalResults == nil || *s.TotalResults <= 0 {
		return errors.New("Speedtest Tracker statistics do not describe measured results")
	}
	for _, metric := range []*Statistic{s.Ping, s.Download, s.Upload} {
		if metric == nil || !nonnegative(metric.Average) || !nonnegative(metric.Minimum) || !nonnegative(metric.Maximum) || *metric.Minimum > *metric.Average || *metric.Average > *metric.Maximum {
			return errors.New("Speedtest Tracker returned incomplete statistics")
		}
	}
	for _, metric := range []*Statistic{s.Download, s.Upload} {
		if metric.AverageBits != nil && (!nonnegative(metric.AverageBits) || math.Trunc(*metric.AverageBits) != *metric.AverageBits || math.Abs(*metric.AverageBits-*metric.Average*8) > 4) {
			return errors.New("Speedtest Tracker statistics have inconsistent byte/bit rates")
		}
	}
	return nil
}
