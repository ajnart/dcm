package e2e

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"log"
	"math/big"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"path/filepath"
	"time"
)

// This route is only a management API fixture. It makes no peer/VPN/browser
// claim, and publishes no container beyond the owned server's loopback port.
type netBirdRoute struct {
	origin string
	caFile string
	roots  *x509.CertPool
	server *http.Server
}

func newNetBirdRoute(root string, listener net.Listener, backend string) (*netBirdRoute, error) {
	fail := func() (*netBirdRoute, error) {
		listener.Close()
		return nil, errors.New("prepare owned NetBird TLS route")
	}
	destination, err := url.Parse(backend)
	if err != nil || destination.Scheme != "http" || destination.Hostname() != "127.0.0.1" || destination.Port() == "" {
		return fail()
	}
	addr, ok := listener.Addr().(*net.TCPAddr)
	if !ok || !addr.IP.Equal(net.ParseIP("127.0.0.1")) {
		return fail()
	}
	caKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return fail()
	}
	leafKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return fail()
	}
	now := time.Now()
	ca := &x509.Certificate{SerialNumber: big.NewInt(1), Subject: pkix.Name{CommonName: "owned NetBird fixture CA"}, NotBefore: now.Add(-time.Minute), NotAfter: now.Add(24 * time.Hour), IsCA: true, BasicConstraintsValid: true, KeyUsage: x509.KeyUsageCertSign}
	caDER, err := x509.CreateCertificate(rand.Reader, ca, ca, &caKey.PublicKey, caKey)
	if err != nil {
		return fail()
	}
	leaf := &x509.Certificate{SerialNumber: big.NewInt(2), Subject: pkix.Name{CommonName: "owned NetBird loopback"}, IPAddresses: []net.IP{net.ParseIP("127.0.0.1")}, NotBefore: now.Add(-time.Minute), NotAfter: now.Add(24 * time.Hour), KeyUsage: x509.KeyUsageDigitalSignature, ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth}}
	leafDER, err := x509.CreateCertificate(rand.Reader, leaf, ca, &leafKey.PublicKey, caKey)
	if err != nil {
		return fail()
	}
	caPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: caDER})
	caFile := filepath.Join(root, "netbird-fixture-ca.pem")
	if err := os.WriteFile(caFile, caPEM, 0o600); err != nil {
		return fail()
	}
	roots := x509.NewCertPool()
	if !roots.AppendCertsFromPEM(caPEM) {
		return fail()
	}
	proxy := httputil.NewSingleHostReverseProxy(destination)
	proxy.Transport = &http.Transport{Proxy: nil}
	director := proxy.Director
	proxy.Director = func(r *http.Request) {
		director(r)
		r.Header.Set("X-Forwarded-Proto", "https")
	}
	proxy.ErrorLog = log.New(io.Discard, "", 0)
	proxy.ErrorHandler = func(w http.ResponseWriter, _ *http.Request, _ error) { w.WriteHeader(http.StatusBadGateway) }
	server := &http.Server{Handler: proxy, ReadHeaderTimeout: 10 * time.Second, ErrorLog: log.New(io.Discard, "", 0)}
	tlsListener := tls.NewListener(listener, &tls.Config{MinVersion: tls.VersionTLS12, Certificates: []tls.Certificate{{Certificate: [][]byte{leafDER, caDER}, PrivateKey: leafKey}}})
	go server.Serve(tlsListener)
	return &netBirdRoute{origin: "https://" + listener.Addr().String(), caFile: caFile, roots: roots, server: server}, nil
}

func (n *netBirdRoute) client() *http.Client {
	return &http.Client{Timeout: 15 * time.Second, Transport: &http.Transport{Proxy: nil, TLSClientConfig: &tls.Config{MinVersion: tls.VersionTLS12, RootCAs: n.roots}}, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
}

func (n *netBirdRoute) close() {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	n.server.Shutdown(ctx)
}

// The shim is child-local, contains no credentials, and never echoes argv.
// An explicit CLI -f is normalized to the canonical file plus our override.
func writeNetBirdDockerWrapper(root, project, name, real string, port int) (string, error) {
	if !filepath.IsAbs(project) || !filepath.IsAbs(real) || port < 1 || port > 65535 {
		return "", errors.New("invalid owned NetBird fixture selectors")
	}
	override := filepath.Join(root, "netbird-override.yml")
	if err := os.WriteFile(override, []byte(fmt.Sprintf("services:\n  server:\n    ports:\n      - 127.0.0.1:%d:80\n", port)), 0o600); err != nil {
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
