# Setup AIStudio2API Proxy (No Rate Limits)

## Why Proxy Mode?

- **No API key rate limits** - bypasses the 10-15 RPM free tier limit
- **Dual quota channels** - each Google account has Playground + Build quotas
- **2 accounts = 100K+ images/day**
- **No browser needed** - WAA_BACKEND=go mode

## Step 1: Download AIStudio2API

```bash
# From GitHub releases
# https://github.com/Mag1cFall/AIStudio2API/releases
# Download linux-amd64.tar.gz (or windows .zip)

wget https://github.com/Mag1cFall/AIStudio2API/releases/latest/download/linux-amd64.tar.gz
tar xzf linux-amd64.tar.gz
cd aistudio2api
```

## Step 2: Login Google Accounts

```bash
# First time setup - opens browser for Google login
./aistudio2api

# Go to http://127.0.0.1:2048 in your browser
# Click "Add Account" and login with your Google account
# Repeat for second account
```

## Step 3: Configure AIStudio2API

Create `.env` in the aistudio2api directory:

```env
LISTEN_ADDR=127.0.0.1:2048
WAA_BACKEND=go
UPSTREAM_CHANNELS=playground,build
PROXY_API_KEY=your-secret-key-here
```

Key settings:
- `WAA_BACKEND=go` - pure Go auth, no browser needed at runtime
- `UPSTREAM_CHANNELS=playground,build` - use both quota channels
- `PROXY_API_KEY` - protect your proxy with a key

## Step 4: Run AIStudio2API

```bash
./aistudio2api
# Should show: Listening on 127.0.0.1:2048
# Should show: 2 accounts loaded
```

## Step 5: Configure gg-api

Edit `gg-api/.env`:

```env
MODE=proxy
PROXY_URL=http://127.0.0.1:2048
PROXY_API_KEY=your-secret-key-here
PROXY_CONCURRENCY=10
```

## Step 6: Generate!

```bash
cd gg-api
npm run gen:images
# or
node src/cli.js generate --type image --file prompts.csv
```

## Performance Expectations

| Accounts | Channels | Est. Images/Day |
|----------|----------|-----------------|
| 1        | 2        | ~50K            |
| 2        | 4        | ~100K+          |
| 3        | 6        | ~150K+          |

## Troubleshooting

- **Connection refused**: Make sure AIStudio2API is running on the configured port
- **401 Unauthorized**: Check PROXY_API_KEY matches between both .env files
- **429 Rate Limited**: Reduce PROXY_CONCURRENCY or add more Google accounts
- **503 Service Unavailable**: Google backend temporarily down, will auto-retry
