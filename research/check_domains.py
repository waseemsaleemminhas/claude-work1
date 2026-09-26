# Checks .com/.net registration by asking Verisign's authoritative gTLD servers directly.
# NXDOMAIN = no delegation in the zone (strong signal the name is unregistered).
# Usage: echo "example.com other.com" | python3 check_domains.py   (needs: pip install dnspython)
import dns.resolver, dns.message, dns.query, dns.rcode, sys
# ask the .com/.net authoritative (Verisign) servers directly
ip = dns.resolver.resolve('a.gtld-servers.net','A')[0].to_text()
def reg(d):
    q = dns.message.make_query(d,'NS')
    try:
        r = dns.query.udp(q, ip, timeout=5)
    except Exception as e:
        return 'ERR'
    if r.rcode()==dns.rcode.NXDOMAIN: return 'LIKELY AVAILABLE'
    ns=[str(x) for rr in r.authority for x in rr][:2]
    return 'TAKEN '+','.join(ns)
names = sys.stdin.read().split()
for n in names:
    print(f"{n:45} {reg(n)}")
