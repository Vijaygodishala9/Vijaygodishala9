import urllib.request
import ssl

base = 'https://cricket.highlightly.net'
paths = [
    '/api/match/53525327',
    '/api/v1/match/53525327',
    '/api/v2/match/53525327',
    '/match/53525327',
    '/api/match/live?match_key=53525327',
    '/api/v1/match/live?match_key=53525327',
    '/api/matches/53525327',
    '/api/v1/matches/53525327',
    '/api/v2/matches/53525327',
    '/match/live/53525327',
    '/api/match/state?match_key=53525327',
    '/api/v1/match/state?match_key=53525327',
    '/api/v2/match/state?match_key=53525327',
]
ctx = ssl.create_default_context()
for p in paths:
    url = base + p
    req = urllib.request.Request(url)
    try:
        with urllib.request.urlopen(req, context=ctx, timeout=10) as res:
            body = res.read(300).decode('utf-8', errors='ignore')
            print(p, res.status, body)
    except Exception as e:
        print(p, type(e).__name__, str(e))
