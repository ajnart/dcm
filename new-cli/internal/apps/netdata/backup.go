package netdata

// EphemeralFIFOs omits the disposable charts.d read-timeout sleep timer. The
// pinned v2.11.0 loopsleepms.sh.inc recreates it with mkfifo in NETDATA_CACHE_DIR:
// https://github.com/netdata/netdata/blob/v2.11.0/src/collectors/charts.d.plugin/loopsleepms.sh.inc#L91-L94
func (App) EphemeralFIFOs() []string {
	return []string{"cache/.netdata_bash_sleep_timer_fifo"}
}
