# Pi-hole traps

## Pitfalls

- The private admin recipe does not publish DNS port 53 or provide LAN DNS service.
- Port 53 and system resolver conflicts can disrupt the entire LAN.

## Security

- Keep administration private and confirm DNS/DHCP ownership before publishing network ports.
