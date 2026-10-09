package e2e

import (
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"os"
	"path/filepath"
)

// This route proves the management API only; no peer/VPN/browser claim.
type netBirdRoute = fixtureTLSRoute

func newNetBirdRoute(root string, listener net.Listener, backend string) (*netBirdRoute, error) {
	return newFixtureTLSRoute(root, listener, backend, "NetBird", "127.0.0.1")
}

// The shim is child-local, contains no credentials, and never echoes argv.
// An explicit CLI -f is normalized to the canonical file plus our override.
func writeNetBirdDockerWrapper(root, project, name, real string, port int) (string, error) {
	if !filepath.IsAbs(project) || !filepath.IsAbs(real) || port < 1 || port > 65535 {
		return "", errors.New("invalid owned NetBird fixture selectors")
	}
	override := filepath.Join(root, "netbird-override.yml")
	if err := os.WriteFile(override, []byte(fmt.Sprintf("services:\n  netbird-server:\n    ports:\n      - 127.0.0.1:%d:80\n", port)), 0o600); err != nil {
		return "", err
	}
	bin := filepath.Join(root, "fixture-bin")
	if err := os.MkdirAll(bin, 0o700); err != nil {
		return "", err
	}
	config, _ := json.Marshal(map[string]string{"project": project, "name": name, "real": real, "override": override, "registry": filepath.Join(root, "backup-helper-names")})
	script := "#!/usr/bin/env python3\nimport csv,json,os,re,sys\nc=json.loads(" + fmt.Sprintf("%q", string(config)) + ")\n" + netBirdDockerGuard
	path := filepath.Join(bin, "docker")
	if err := os.WriteFile(path, []byte(script), 0o700); err != nil {
		return "", err
	}
	return path, nil
}

const netBirdDockerGuard = `
def deny():
    sys.stderr.write('owned NetBird Docker selector refused\n')
    sys.exit(96)
a=sys.argv[1:]
helper='docker.io/library/alpine@sha256:5291449c3df73caf6ed85e649dec1b9e818b39a5d8c871e97afc13e9cd5e8fa8'
if not a: deny()
if a in (['version','--format','{{.Server.Version}}'],['info','--format','{{json .SecurityOptions}}'],['compose','version','--short']):
    pass
elif a[0]=='compose':
    i=1; p=False; d=False; out=[]
    while i<len(a) and a[i].startswith('-'):
        key=a[i]
        if key not in ('-p','--project-name','--project-directory','--env-file','-f','--file','--progress') or i+1>=len(a): deny()
        val=a[i+1]; i+=2
        if key in ('-p','--project-name'):
            if p or val!=c['name']: deny()
            p=True
        elif key=='--project-directory':
            if d or val!=c['project']: deny()
            d=True
        elif key=='--env-file':
            if val not in (c['project']+'/.env',c['project']+'/secrets.env'): deny()
        elif key in ('-f','--file'):
            if val!=c['project']+'/compose.yml': deny()
            continue
        elif key=='--progress' and val!='json': deny()
        out.extend((key,val))
    if not p or not d or i>=len(a): deny()
    if a[i] not in ('up','down','pull','start','stop','restart','ps','images','logs'): deny()
    if any(x in ('-p','--project-name','--project-directory','--env-file','-f','--file') or x.startswith(('--project-name=','--project-directory=','--file=')) for x in a[i+1:]): deny()
    a=['compose']+out+['-f',c['project']+'/compose.yml','-f',c['override']]+a[i:]
elif a[0]=='image' and len(a)>2 and a[1]=='inspect':
    pass
elif a==['pull',helper]:
    pass
elif a[0]=='run':
    fixed=['run','--rm','--name']
    if a[:3]!=fixed or len(a)<4 or not re.fullmatch(r'selfhost-backup-[0-9a-f]{16}',a[3]): deny()
    name=a[3]
    i=4
    required=['--network','none','--read-only','--user','0:0','--security-opt','no-new-privileges','--cap-drop','ALL','--cap-add','DAC_OVERRIDE']
    if a[i:i+len(required)]!=required: deny()
    i+=len(required)
    if a[i:i+4]==['--cap-add','CHOWN','--cap-add','FOWNER']: i+=4
    if a[i:i+1]!=['--mount'] or i+1>=len(a): deny()
    try: fields=next(csv.reader([a[i+1]]))
    except Exception: deny()
    if len(fields) not in (3,4) or not fields[1].startswith('src='): deny()
    source=fields[1][4:]
    relative=os.path.relpath(source,c['project'])
    if relative!='apps/netbird' and not re.fullmatch(r'\.restore-[0-9]+/(apps/netbird|replaced-netbird)',relative): deny()
    mount=['type=bind','src='+source,'dst=/owned']
    if fields not in (mount,mount+['readonly']): deny()
    if os.path.realpath(source)!=source or not os.path.isdir(source): deny()
    i+=2
    if a[i:]!=['--entrypoint','sh','-i',helper,'-s']: deny()
    fd=os.open(c['registry'],os.O_CREAT|os.O_WRONLY|os.O_APPEND,0o600)
    with os.fdopen(fd,'a') as f: f.write(name+'\n')
elif a[0]=='rm' and len(a)==3 and a[1]=='--force':
    try:
        with open(c['registry']) as f: owned=a[2] in f.read().splitlines()
    except OSError: owned=False
    if not owned: deny()
elif a[0]=='container' and a[1:4]==['inspect','--format','{{.State.Status}}'] and len(a)==5:
    try:
        with open(c['registry']) as f: owned=a[4] in f.read().splitlines()
    except OSError: owned=False
    if not owned: deny()
else:
    deny()
os.execv(c['real'],[c['real']]+a)
`

func reserveNetBirdFixturePorts(r *portReservation) (int, net.Listener, error) {
	r.pool.mu.Lock()
	defer r.pool.mu.Unlock()
	claim := func() (net.Listener, error) {
		for attempt := 0; attempt < 1024; attempt++ {
			listener, err := net.Listen("tcp4", "127.0.0.1:0")
			if err != nil {
				return nil, err
			}
			port := publishedPort{port: listener.Addr().(*net.TCPAddr).Port, protocol: "tcp"}
			if r.pool.used[port] != nil {
				listener.Close()
				continue
			}
			r.pool.used[port] = r
			r.owned = append(r.owned, port)
			return listener, nil
		}
		return nil, errors.New("owned NetBird fixture ports unavailable")
	}
	backend, err := claim()
	if err != nil {
		return 0, nil, err
	}
	r.listeners = append(r.listeners, backend)
	tlsListener, err := claim()
	if err != nil {
		return 0, nil, err
	}
	return backend.Addr().(*net.TCPAddr).Port, tlsListener, nil
}
