# Audit locale tiếng Việt — 2026-08-17

## Phạm vi

- Đã rà provider/dictionary i18n, layout dùng chung, auth/onboarding, dashboard, Smart Insights, danh mục mô phỏng, Quant Lab, backtest, optimizer, Strategy Lab và các bảng/biểu đồ liên quan.
- Đã đối chiếu các route chính với `graphify-out/graph.json` để xác định provider locale và các entry point. Lệnh cập nhật Graphify không chạy được trên Windows do lỗi wrapper `uv trampoline`; không dùng Graphify làm bằng chứng runtime.

## Đã sửa

- Hoàn thiện dictionary tiếng Việt cho navigation, trạng thái dữ liệu, auth, workspace, danh mục, Quant Lab, backtest và Smart Insights.
- Thay các nhãn hard-code còn sót trong modal, bảng, biểu đồ, tooltip, trạng thái loading/empty/error và aria-label.
- Chuẩn hóa nhãn động: trạng thái backtest/Kronos, phân loại Sợ hãi & Tham lam, nhãn ETF/phái sinh, asset `Global`, sentiment, tên series và ngày giờ theo `vi-VN`.
- Giữ nguyên ticker, mã nguồn/provider, tên mô hình, mã API và thuật ngữ định lượng cần interoperable (BTC, ETF, CBBI, MAE, MASE, QuantStats, SMA/EMA, DCA, VND/USD…).

## Kiểm chứng

- `npx vitest run --testTimeout=30000`: **128 file, 688 test đạt**. Test deploy contract cần timeout dài hơn mặc định do tạo archive kiểm checksum.
- `npm run test:python`: **743 đạt, 29 bỏ qua**, 5 cảnh báo thư viện upstream.
- `npm run typecheck`: đạt.
- `npm run lint`: đạt.
- `npm run format:check`: đạt.
- `npm run build`: đạt; Next.js compile, TypeScript, static generation và route manifest đều hoàn tất.
- Local smoke: `http://localhost:3100/` trả HTTP 200; dashboard, `/portfolio` redirect sang đăng nhập và auth/footer đều hiển thị tiếng Việt; console browser không có error/warning.

## Còn giữ có chủ đích

Tên thương hiệu DataVest, ticker/mã tài sản, URL/provider, enum/API field và thuật ngữ định lượng không dịch để tránh làm sai nghĩa hoặc hỏng liên kết dữ liệu. Thông báo lỗi do backend trả về nguyên văn vẫn có thể giữ thuật ngữ kỹ thuật; các fallback do UI kiểm soát đã dùng dictionary tiếng Việt.
