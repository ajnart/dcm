# Pi-hole traps

## Pitfalls

- The private admin recipe does not publish DNS port 53 or provide LAN DNS service.
- Port 53 and system resolver conflicts can disrupt the entire LAN.
- The Go CLI's `--set pihole.dns-port=PORT` changes only the TCP/UDP host publication; container DNS remains on 53. The default remains 53, which ordinary LAN DNS clients expect.

## Security

- Keep administration private and confirm DNS/DHCP ownership before publishing network ports.
