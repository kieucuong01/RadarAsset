# Thiết kế sprint ổn định MVP

**Ngày:** 2026-08-05

**Trạng thái:** Đã được người dùng duyệt qua từng phần

**Phạm vi:** Responsive mobile, tính trung thực của dữ liệu, liên kết và hành động trên giao diện

## 1. Mục tiêu

Sprint này làm cho MVP hiện tại sử dụng được trên mobile và không tạo cảm giác rằng dữ liệu hoặc hành động mô phỏng đang vận hành thật.

Kết quả cần đạt:

- Ba trang hiện có (`/`, `/portfolio`, `/quant-lab`) truy cập được trên mobile qua menu chính.
- Không còn cuộn ngang ngoài ý muốn tại các viewport 375px, 390px, 768px và desktop.
- Mọi dữ liệu hiển thị được nhận diện rõ là dữ liệu hệ thống, dữ liệu mẫu hoặc mô phỏng.
- Không còn dead link, `href="#"`, route tài sản chưa tồn tại hoặc nút chỉ hiển thị thông báo thành công giả.
- Hành động chỉ được bật khi có handler thực và có thể phản ánh kết quả thật từ hệ thống.

## 2. Phương án được chọn

Áp dụng phương án ổn định có kiểm soát: giữ nguyên cấu trúc sản phẩm và ba route hiện tại, tận dụng API đã có, sửa lỗi responsive tại nguồn và vô hiệu hóa hoặc loại bỏ những khả năng chưa tồn tại.

Không chọn phương án chỉ che lỗi CSS/ẩn nút hàng loạt vì không giải quyết tính nhất quán. Không mở rộng thành sprint xây thêm AI audio, engine backtest, trang chi tiết tài sản hoặc hệ thống cảnh báo mới vì vượt mục tiêu ổn định MVP.

## 3. Ngoài phạm vi

- Xây thêm route `/asset/[symbol]` hoặc trang chi tiết tài sản.
- Xây dịch vụ phát audio cho AI Briefing.
- Xây engine backtest, dự báo giá hoặc Monte Carlo vận hành thật.
- Xây backend mới cho thông báo hoặc cảnh báo. Watchlist chỉ sử dụng endpoint `GET/POST /api/watchlist` hiện có.
- Thay đổi mô hình xác thực demo hiện tại.
- Thiết kế lại toàn bộ giao diện, schema database, pipeline dữ liệu hoặc quy trình deploy.

## 4. Kiến trúc giao diện

### 4.1. Điều hướng mobile

`Header` tiếp tục dùng cấu hình điều hướng hiện có cho desktop và mobile. Mobile dùng component `Sheet` đã có trong dự án, mở bằng nút menu có nhãn truy cập rõ ràng.

Menu chỉ chứa ba route tồn tại:

- Tổng quan: `/`
- Danh mục: `/portfolio`
- Quant Lab: `/quant-lab`

Route hiện tại có trạng thái active. Khi chọn route, menu đóng. Nút mở/đóng có vùng chạm tối thiểu 44px, hỗ trợ bàn phím, focus và phím Escape theo hành vi chuẩn của `Sheet`.

### 4.2. Sửa overflow tại nguồn

Không thêm `overflow-x-hidden` lên `html`, `body` hoặc container cấp trang để che lỗi.

Các grid/flex có nội dung dài phải cho phép phần tử con co lại bằng `min-w-0`. Cột linh hoạt dùng `minmax(0, 1fr)` khi cần. Ticker được giới hạn trong container riêng có overflow được kiểm soát, không được làm tăng `scrollWidth` của trang.

Điểm ưu tiên là khu vực Market Pulse trong `SmartInsights`, các hàng ticker và những flex/grid chứa văn bản, bảng hoặc biểu đồ rộng. Mỗi sửa đổi phải được xác nhận bằng đo `scrollWidth <= clientWidth` trong trình duyệt.

## 5. Mô hình nguồn dữ liệu

Tạo một mô hình trạng thái dùng chung thay vì viết nhãn tùy ý trong từng component:

| Trạng thái | Ý nghĩa | Cách hiển thị |
| --- | --- | --- |
| `SYSTEM` | Dữ liệu lấy từ database hoặc API vận hành hiện có | `Dữ liệu hệ thống` |
| `SAMPLE` | Seed, fallback hoặc nội dung mẫu | `Dữ liệu mẫu` |
| `SIMULATED` | Kết quả tính toán/diễn tiến giả lập | `Mô phỏng` |
| `UNAVAILABLE` | Khả năng chưa có trong MVP | `Chưa khả dụng trong MVP` |

Một component nhãn dùng chung nhận trạng thái và phần mô tả tùy chọn. Màu sắc hỗ trợ nhận biết nhưng nội dung chữ là bắt buộc để không phụ thuộc vào màu.

Quy tắc dữ liệu:

- Dữ liệu fallback không được trình bày như dữ liệu live; fallback luôn mang `SAMPLE`.
- Dữ liệu từ API chỉ mang `SYSTEM` khi request thành công và nguồn đó thực sự là dữ liệu hệ thống.
- Kết quả Quant Lab hiện tại mang `SIMULATED` ở cấp trang và gần các kết quả quan trọng.
- Xóa hoặc đổi các tuyên bố không có bằng chứng như `ENGINE LIVE`, `1.2M backtests`, thời gian làm mới giả và số lượng nguồn giả.
- Không tự thay dữ liệu API lỗi bằng số mô phỏng mà thiếu nhãn.

## 6. Chính sách hành động và liên kết

### 6.1. Hành động

Mỗi control trông như có thể thao tác phải thuộc đúng một nhóm:

1. **Hoạt động thật:** có handler thực, gọi API hoặc cập nhật trạng thái thật, thể hiện loading và phản ánh đúng thành công/thất bại.
2. **Chưa khả dụng:** bị disabled, có nhãn hoặc mô tả `Chưa khả dụng trong MVP`, không phát toast thành công.
3. **Không cần xuất hiện:** loại khỏi giao diện nếu không mang giá trị giải thích.

Áp dụng cụ thể:

- `Listen to AI Briefing`: giữ ở trạng thái disabled kèm nhãn `Chưa khả dụng trong MVP`.
- `Apply to My Portfolio`: giữ ở trạng thái disabled kèm giải thích rằng MVP chưa có bước nhập khối lượng, giá và xác nhận giao dịch. Không gọi trực tiếp API giao dịch từ đề xuất AI.
- `Add asset` của Watchlist: nối vào `POST /api/watchlist`, có loading, lỗi và chỉ báo thành công sau HTTP thành công; sau đó cập nhật danh sách từ phản hồi API.
- Chỉnh sửa cảnh báo: disabled kèm nhãn chưa khả dụng vì repository không có API cảnh báo riêng.
- Nút thông báo trên header: loại bỏ vì repository không có danh sách hoặc luồng thông báo để mở.
- Lệnh backtest/refresh trong Command Palette: loại bỏ nếu chỉ phát toast giả.
- Không dùng toast thành công để mô phỏng một thao tác chưa xảy ra.

### 6.2. Liên kết

- Command Palette chỉ điều hướng đến route tồn tại.
- Các mục `/asset/BTC`, `/asset/ETH` và route tài sản tương tự bị loại cho đến khi có trang thật.
- Footer chỉ giữ ba liên kết sản phẩm hợp lệ (`/`, `/portfolio`, `/quant-lab`) và thông tin thương hiệu/bản quyền. Loại bỏ nhóm Resources, Company và social icon chưa có URL thật.
- Không dùng `href="#"` và không cho nhiều mục khác nhau cùng trỏ về `/` chỉ để tránh lỗi.

## 7. Ranh giới component

- `Header`: chịu trách nhiệm render điều hướng desktop/mobile từ cùng một danh sách route.
- Component nhãn nguồn dữ liệu: chỉ ánh xạ trạng thái sang nhãn và style; không tự quyết định nguồn dữ liệu.
- Cấu hình trạng thái tính năng: mô tả khả năng nào hoạt động, mô phỏng hoặc chưa khả dụng; component tiêu thụ cấu hình này để tránh hành vi không nhất quán.
- `SmartInsights`: trình bày nội dung và truyền trạng thái đúng cho nhãn/nút; không giả lập thành công.
- `QuantLab`: giữ logic mô phỏng hiện có nhưng công khai bản chất mô phỏng và bỏ ngôn ngữ vận hành thật.
- `CommandPalette` và `Footer`: chỉ cung cấp điều hướng hợp lệ; không chứa route giả.

Không thực hiện refactor rộng ngoài những điểm cần thiết để các ranh giới trên rõ ràng và có thể kiểm thử.

## 8. Luồng dữ liệu và xử lý lỗi

1. Component gọi API hiện có theo luồng hiện tại.
2. Khi thành công, component hiển thị dữ liệu và nhãn nguồn tương ứng.
3. Khi thất bại, component giữ dữ liệu hợp lệ gần nhất trong state của phiên hiển thị hiện tại và hiển thị lỗi rõ ràng. Nếu chưa từng tải thành công, hiển thị error/empty state thay vì tự sinh số liệu.
4. Nếu dùng fallback, fallback phải có nhãn `Dữ liệu mẫu` ngay trong cùng khu vực.
5. Hành động ghi dữ liệu có trạng thái loading, ngăn gửi lặp, xử lý lỗi và chỉ báo thành công sau phản hồi thành công thật.

Thông báo lỗi cần mô tả được việc gì không tải hoặc không lưu được. Không dùng thông báo thành công chung chung khi không có thay đổi trạng thái thực.

## 9. Khả năng truy cập và trạng thái giao diện

- Vùng chạm tương tác chính tối thiểu 44px trên mobile.
- Nút icon có accessible name.
- Focus ring nhìn thấy được ở light và dark mode.
- Nút disabled có độ tương phản đủ đọc và có giải thích bằng chữ.
- Nhãn nguồn dữ liệu không chỉ dựa vào màu sắc.
- Menu mobile hỗ trợ focus management và bàn phím theo component `Sheet`.

## 10. Kiểm thử

### 10.1. Kiểm thử tự động

- Kiểm thử ánh xạ mọi trạng thái nguồn dữ liệu sang nhãn hợp lệ.
- Kiểm thử cấu hình tính năng để một hành động chưa khả dụng không được khai báo như hành động hoạt động.
- Dùng kiểm thử cấu hình cho route/action registry và bước quét nguồn bằng `rg` trong kiểm chứng để phát hiện `href="#"`, chuỗi `/asset/` và các toast thành công giả trong `Header`, `SmartInsights`, `CommandPalette` và `Footer`.
- Chạy toàn bộ unit test hiện có, TypeScript, lint và production build.

### 10.2. Kiểm thử trình duyệt

Kiểm tra ở 375px, 390px, 768px và một viewport desktop:

- `document.documentElement.scrollWidth <= document.documentElement.clientWidth` trên cả ba route.
- Menu mobile mở/đóng, thể hiện active route, điều hướng đúng và đóng sau điều hướng.
- Ba route tải không có lỗi console.
- Không có control hoạt động giả hoặc dead link trong các khu vực đã sửa.
- Nhãn và trạng thái disabled đọc được trong light/dark mode.
- Ticker và nội dung dài không mở rộng chiều ngang trang.

## 11. Tiêu chí nghiệm thu

Sprint chỉ hoàn tất khi đáp ứng đồng thời:

- Không còn horizontal overflow ngoài ý muốn tại các viewport mục tiêu.
- Mobile truy cập được toàn bộ điều hướng chính.
- Không còn `href="#"`, route tài sản chưa tồn tại hoặc link footer giả trong UI đã rà soát.
- Không còn nút bật mà không có hành động thật, và không còn toast thành công giả.
- Dữ liệu mẫu và mô phỏng luôn được gắn nhãn rõ ràng; các tuyên bố live không có bằng chứng đã bị xóa.
- Test, typecheck, lint và build vượt qua theo baseline của repository; mọi cảnh báo còn lại được báo cáo riêng, không bị mô tả thành lỗi đã sửa.

## 12. Bàn giao

Sprint này kết thúc ở thay đổi mã cục bộ đã được kiểm chứng. Commit/push/deploy sản phẩm không nằm trong phạm vi trừ khi người dùng yêu cầu riêng. Tài liệu thiết kế được commit riêng trước khi lập kế hoạch triển khai.
