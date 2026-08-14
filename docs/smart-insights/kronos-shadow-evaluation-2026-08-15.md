# Kronos BTC shadow evaluation — 2026-08-15

## Kết luận vận hành

- Trạng thái: `ACCUMULATING` (`1 / 180` cutoff ngoài mẫu).
- Phạm vi: BTC, nến ngày, horizon 1/3/7 ngày.
- Mục đích: đo chất lượng dự báo; `decisionUse = NONE`.
- Kronos không được import vào Market Pulse, cảnh báo, cá nhân hóa, danh mục hay logic khuyến nghị.
- UI luôn hiển thị `SHADOW / KHÔNG DÙNG CHO QUYẾT ĐỊNH`; khi thiếu provenance sẽ fail closed và không sinh dữ liệu mẫu.

## Provenance cố định

| Thành phần | Revision |
| --- | --- |
| Kronos source | `67b630e67f6a18c9e9be918d9b4337c960db1e9a` |
| Kronos-small model | `901c26c1332695a2a8f243eb2f37243a37bea320` |
| Tokenizer-base | `0e0117387f39004a9016484a186a908917e22426` |
| Seed | `20260814` |
| Runtime manifest | 116 files; SHA-256 `1d68034cd9c0b6b2f801b3b420d72f79c35157de41d4f63173512b905386d333` |

Upstream được pin từ [Kronos tại commit cố định](https://github.com/shiyu-coder/Kronos/tree/67b630e67f6a18c9e9be918d9b4337c960db1e9a). Không copy mã AGPL của WorldMonitor.

## Data gate

| Kiểm tra | Kết quả |
| --- | --- |
| Provider | `binance-public-spot` qua market ingestion hiện có |
| Dataset version | `2333acec-9e48-4275-8dd9-faa94802551b` |
| Khoảng dữ liệu | 2017-08-17 đến 2026-08-13 UTC |
| Số nến / timestamp duy nhất | 3.284 / 3.284 |
| Ngày thiếu trong chuỗi daily | 0 |
| Điều kiện đọc | active, quality passed/warning, `source_metadata.mode = live` |
| Input fingerprint | `4d968eb169593b48c3b1697e50df2432efc8566283cb6c44277cdaa9819b4752` |

## Live run

| Kiểm tra | Kết quả |
| --- | --- |
| Migration | `202608150001_kronos_shadow` đã áp dụng |
| Run cho workspace `ktc` | `d017ec3a-5a99-47bf-a6b3-106a527c159b` |
| Research run | `completed` |
| Provider run | `succeeded` |
| Forecast rows | 6 (3 current shadow + 3 realized OOS) |
| Model evaluation rows | 1 |
| Evaluation records | 15 (Kronos + 4 baseline, mỗi model 3 horizon) |
| Thời gian CPU cho 1 cutoff + current | 206,7 giây |

Một lần ghi trước đó đã rollback đúng khi provider status không hợp lệ; lỗi đã được sửa thành trạng thái schema cho phép (`succeeded`). Sau đó cả lần ghi live và đọc lại DB đều thành công.

## Cách tích lũy 180 cutoff

Runner chạy incremental mỗi ngày sau khi market ingestion hoàn tất. Evaluation mới được gộp với evaluation gần nhất của cùng workspace/methodology, khử trùng lặp theo `(model, horizon, forecastGeneratedAt)`, rồi tính lại MAE, MASE, directional accuracy, Spearman IC và coverage. Vì vậy tiến độ tăng theo ngày mới mà không tính lại toàn bộ 180 cửa sổ.

Gate chỉ chuyển sang `READY_SHADOW` khi có đủ 180 ngày cutoff duy nhất. Mốc này không tự động cho phép model tác động quyết định; việc nâng cấp phạm vi phải là thay đổi riêng, có kiểm định và phê duyệt.

## UI và kiểm định

- Tab Crypto → `BTC Forecast` dùng card KPI, fan chart P10–P90, rolling error, bảng benchmark và lịch sử dự báo.
- Browser live tại `http://localhost:3120/`: dữ liệu thật hiển thị, không có fallback, không tràn ngang ở viewport desktop 1.521 px.
- Component regression có nhánh responsive riêng: bảng desktop và stacked rows mobile; trạng thái unavailable/failed không tạo fake data.
- Full regression: Python `487 passed, 27 skipped`; Vitest `397 passed` trong 77 files; ESLint `0 error` (13 warning Fast Refresh có sẵn); Next production build webpack thành công.
- Prisma: 29 migration được nhận diện và database schema đang up to date.

## Giới hạn hiện tại

- Chỉ 1 cutoff OOS nên mọi metric hiện tại chưa có ý nghĩa để ra quyết định.
- Full backfill 180 cutoff trên CPU local ước tính hơn 6 giờ từ timing thực tế; không giả lập `READY_SHADOW`.
- Cần chạy ingestion trước runner; nếu chưa có nến daily mới, logic dedupe giữ nguyên số cutoff.
