# Hướng dẫn cài đặt GG-API

## Tổng quan

GG-API tạo ảnh/video hàng loạt qua AIStudio2API - không cần API key, không giới hạn rate limit.
- 2 tài khoản Google = ~100K+ ảnh/ngày
- Không cần trình duyệt khi chạy (WAA_BACKEND=go)
- Hỗ trợ: tạo ảnh, video, ảnh có tham chiếu

## Bước 1: Cài AIStudio2API

### Windows
```bash
# Tải từ GitHub releases
# https://github.com/Mag1cFall/AIStudio2API/releases
# Tải file: windows-amd64.zip
# Giải nén và chạy start.bat
```

### Linux
```bash
wget https://github.com/Mag1cFall/AIStudio2API/releases/latest/download/linux-amd64.tar.gz
tar xzf linux-amd64.tar.gz
cd aistudio2api
chmod +x aistudio2api
./aistudio2api
```

### Docker
```bash
docker run -d -p 2048:2048 -v ./data:/app/data mag1cfall/aistudio2api
```

## Bước 2: Đăng nhập tài khoản Google

1. Mở trình duyệt: http://127.0.0.1:2048
2. Click "Add Account"
3. Đăng nhập tài khoản Google thứ 1
4. Lặp lại cho tài khoản Google thứ 2
5. Kiểm tra: cả 2 tài khoản hiện trạng thái "Active"

> Chỉ cần đăng nhập 1 lần. Sau đó AIStudio2API tự quản lý session.

## Bước 3: Cấu hình AIStudio2API

Tạo file `.env` trong thư mục aistudio2api:

```env
LISTEN_ADDR=127.0.0.1:2048
WAA_BACKEND=go
UPSTREAM_CHANNELS=playground,build
PROXY_API_KEY=mat-khau-cua-ban
```

Giải thích:
- `WAA_BACKEND=go` → chạy bằng Go thuần, KHÔNG cần trình duyệt
- `UPSTREAM_CHANNELS=playground,build` → dùng cả 2 kênh quota
- `PROXY_API_KEY` → mật khẩu bảo vệ API (tùy chọn)

Restart AIStudio2API sau khi sửa .env.

## Bước 4: Cài GG-API

```bash
git clone https://github.com/ffilm2356-droid/gg-api.git
cd gg-api
npm install
npm run setup
```

## Bước 5: Cấu hình GG-API

Sửa file `.env` trong thư mục gg-api:

```env
PROXY_URL=http://127.0.0.1:2048
PROXY_API_KEY=mat-khau-cua-ban
CONCURRENCY=10
```

## Bước 6: Tạo file prompts

### CSV format (prompts.csv):
```csv
id,prompt
1,"Cô gái Việt Nam mặc áo dài đỏ đứng trước hồ Hoàn Kiếm"
2,"Cảnh hoàng hôn trên biển Đà Nẵng"
3,"Quán cà phê vintage Sài Gòn ban đêm"
```

### JSON format (prompts.json):
```json
[
  {"id": "1", "prompt": "Cô gái Việt Nam mặc áo dài đỏ"},
  {"id": "2", "prompt": "Cảnh hoàng hôn trên biển Đà Nẵng"}
]
```

## Bước 7: Chạy!

```bash
# Tạo ảnh
npm run gen:images

# Tạo video
npm run gen:videos

# Tạo ảnh với ảnh tham chiếu
node src/cli.js generate --ref anh-tham-chieu.png --file prompts.csv

# Xem trạng thái
npm run status
```

## Tùy chỉnh nâng cao

```bash
# Tăng concurrency (nhanh hơn, nhưng có thể bị rate limit)
CONCURRENCY=20

# Đổi model
IMAGE_MODEL=gemini-2.0-flash-exp

# Debug mode
LOG_LEVEL=debug

# Dùng file prompts khác
node src/cli.js generate --file my-prompts.json --type image
```

## Hiệu suất ước tính

| Số tài khoản | Kênh quota | Ảnh/ngày (ước tính) |
|---------------|------------|---------------------|
| 1             | 2          | ~50,000             |
| 2             | 4          | ~100,000+           |
| 3             | 6          | ~150,000+           |

## Xử lý lỗi

| Lỗi | Nguyên nhân | Cách sửa |
|------|-------------|----------|
| Connection refused | AIStudio2API chưa chạy | Chạy AIStudio2API trước |
| 401 Unauthorized | Sai PROXY_API_KEY | Kiểm tra key khớp giữa 2 file .env |
| 429 Rate limited | Quá nhiều request | Giảm CONCURRENCY hoặc thêm tài khoản |
| 503 Unavailable | Google tạm thời lỗi | Tự động retry, chờ 1-2 phút |
| No image in response | Prompt bị block | Sửa prompt, tránh nội dung nhạy cảm |
