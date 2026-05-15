# Timesheet AutoFill — Chrome Extension

Tự động điền timesheet hàng tuần của OpenWay với một cú click. Giao diện hiện đại, trực quan, hỗ trợ tùy biến linh hoạt.

## 🚀 Tính năng nổi bật

- **Tự động hóa**: Điền đầy đủ Project, Task và Thời gian cho cả tuần chỉ với 1 click.
- **Thông minh**: Tự động tính toán ngày **Week Ending** (Chủ nhật tuần trước nếu là Thứ 2, ngược lại là Chủ nhật tuần này).
- **Preset**: Lưu cấu hình công việc lặp lại thành các Preset để tái sử dụng nhanh chóng.
- **Đồng bộ hóa**: Tính năng **Apply All** giúp sao chép Project hoặc nội dung Task cho tất cả các ngày đang bật.
- **Tìm kiếm Project**: Hỗ trợ tìm kiếm project trực tiếp từ trang timesheet và lưu vào danh sách nhanh.
- **Theme**: Hỗ trợ Dark/Light mode và 7 màu chủ đạo theo nhận diện thương hiệu OpenWay.
- **Dễ dàng quản lý**: Hỗ trợ Xuất/Nhập (Export/Import) cấu hình và Preset dưới dạng file JSON.

## 🛠 Cài đặt

1. Clone project bằng git để có thể cập nhật sau này:
   ```bash
   git clone git@github.com:tuantoquq/internal-timesheet-ext.git
   ```
2. Mở trình duyệt Chrome và truy cập địa chỉ `chrome://extensions/`.
3. Bật **Developer mode** (Chế độ cho nhà phát triển) ở góc trên bên phải.
4. Nhấn nút **Load unpacked** (Tải tiện ích đã giải nén).
5. Chọn thư mục chứa mã nguồn này.

## 📖 Hướng dẫn sử dụng

1. Truy cập trang Timesheet nội bộ: `http://10.145.48.117:9099/...`.
2. Mở Extension trên thanh công cụ của Chrome.
3. **Cài đặt**: Thiết lập giờ giấc mặc định tại tab **Cài đặt**.
4. **Điền task**: 
   - Chọn các ngày cần điền.
   - Chọn Project từ danh sách đã lưu (hoặc tìm kiếm tại tab **Presets**).
   - Nhập nội dung công việc.
5. Nhấn **Điền timesheet** để thực hiện việc autofill.
6. Sử dụng nút **Xoá form** để dọn sạch dữ liệu cả trên extension và trên trang web khi cần làm lại.

## 🔄 Cập nhật phiên bản

Extension kiểm tra version mới nhất từ `CHANGELOG.md` trên GitHub public repo. Nếu có bản mới, tab **Cài đặt** sẽ hiển thị trạng thái **Update available**.

Trên Windows, chạy file:

```bat
update.bat
```

Sau khi update xong, mở `chrome://extensions/` và bấm **Reload** trên card Timesheet AutoFill.

Khi release version mới, cập nhật `manifest.json` và thêm heading mới vào `CHANGELOG.md` theo dạng:

```md
## [1.0.1] - 2026-05-15
```

## 📂 Cấu trúc dự án

- `popup.html/js`: Giao diện và logic chính của extension.
- `content.js`: Script chạy trực tiếp trên trang timesheet để thực hiện điền dữ liệu.
- `popup-core.js`: Thư viện logic dùng chung (xử lý thời gian, tìm kiếm project).
- `AGENTS.md`: Hướng dẫn chi tiết dành cho nhà phát triển.

## 📄 Bản quyền

Dự án được phát hành dưới [MIT License](LICENSE).

---
*Built with ❤️ for OpenWay by @tuannha*
