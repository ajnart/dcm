# Public /docker-entrypoint.sh functions extracted from
# timescale/timescaledb-ha:pg18.4-ts2.29.1
# sha256:a4618863a155f0e305224cad44dc50196e3136f9bfb0b13127da82955a093f0c
# Vendor functions below are unchanged; the Go test supplies controlled commands.
docker_create_db_directories() {
	local uid
	uid="$(id -u)"

	[ ! -d "$PGDATA" ] && mkdir -p "$PGDATA"

	# ignore failure since there are cases where we can't chmod (and PostgreSQL might fail later anyhow - it's picky about permissions of this directory)
	chmod 700 "$PGDATA" 2>/dev/null || :

	# ignore failure since it will be fine when using the image provided directory; see also https://github.com/docker-library/postgres/pull/289
	mkdir -p /var/run/postgresql 2>/dev/null || :
	chmod 1777 /var/run/postgresql 2>/dev/null || :

	# Create the transaction log directory before initdb is run so the directory is owned by the correct user
	if [ -n "${POSTGRES_INITDB_WALDIR:-}" ]; then
		mkdir -p "$POSTGRES_INITDB_WALDIR"
		if [ "$uid" -eq 0 ]; then
			find "$POSTGRES_INITDB_WALDIR" \! -user postgres -exec chown postgres '{}' + || :
		fi
		chmod 700 "$POSTGRES_INITDB_WALDIR" || :
	fi

	# allow the container to be started with `--user`
	if [ "$uid" -eq 0 ]; then
		find "$PGDATA" \! -user postgres -exec chown postgres: '{}' + || :
		find /var/run/postgresql \! -user postgres -exec chown postgres: '{}' + || :
	fi
}
_main() {
	local uid
	uid="$(id -u)"

	# if first arg looks like a flag, assume we want to run postgres server
	if [ "${1:0:1}" = '-' ]; then
		set -- postgres "$@"
	fi

	if [ "$1" = 'postgres' ] && ! _pg_want_help "$@"; then
		docker_setup_env

		# setup data directories and permissions (when run as root)
		docker_create_db_directories
		if [ "$uid" -eq 0 ]; then
			# then restart script as postgres user
			exec gosu postgres "${BASH_SOURCE[0]}" "$@"
		fi

		[ "$uid" -ne 0 ] && setup_nss_wrapper

		# only run initialization on an empty data directory
		if [ -z "$DATABASE_ALREADY_EXISTS" ]; then
			docker_verify_minimum_env

			# check dir permissions to reduce likelihood of half-initialized database
			ls /docker-entrypoint-initdb.d/ >/dev/null

			docker_init_database_dir
			pg_setup_hba_conf "$@"

			# PGPASSWORD is required for psql when authentication is required for 'local' connections via pg_hba.conf and is otherwise harmless
			# e.g. when '--auth=md5' or '--auth-local=md5' is used in POSTGRES_INITDB_ARGS
			export PGPASSWORD="${PGPASSWORD:-$POSTGRES_PASSWORD}"
			docker_temp_server_start "$@"

			docker_setup_db
			docker_process_init_files /docker-entrypoint-initdb.d/*

			docker_temp_server_stop
			unset PGPASSWORD

			cat <<-'EOM'

				PostgreSQL init process complete; ready for start up.

			EOM
		else
			cat <<-'EOM'

				PostgreSQL Database directory appears to contain a database; Skipping initialization

			EOM
		fi

		# Note- this permission wait loop is not a duplicate- due to the timing issue with docker, only one might not
		# be good enough
		permission_wait_loop
	fi

	exec "$@"
}
