# Timesheet AutoFill — Chrome & Firefox Extension

Tự động điền timesheet hàng tuần của OpenWay với một cú click. Hỗ trợ đăng nhập và submit trực tiếp từ extension mà không cần mở trang timesheet.

---

## 🚀 Tính năng nổi bật

- **Tự động hóa** — Điền đầy đủ Project, Task và Thời gian cho cả tuần chỉ với 1 click
- **Submit headless** — Đăng nhập và lưu timesheet trực tiếp từ extension, không cần mở tab timesheet
- **Kiểm tra session tự động** — Phát hiện phiên hết hạn ngay khi mở popup, nhắc đăng nhập lại trước khi submit
- **Thông minh** — Tự động tính toán ngày **Week Ending** (Chủ nhật tuần trước nếu là Thứ 2, ngược lại là Chủ nhật tuần này)
- **Multi-task** — Thêm nhiều task trong cùng một ngày, tự động chia giờ với nút **Auto time**
- **Preset** — Lưu cấu hình công việc lặp lại để tái sử dụng nhanh chóng
- **Apply All** — Sao chép Project hoặc nội dung Task cho tất cả các ngày đang bật
- **Tìm kiếm Project** — Tìm và lưu project trực tiếp từ danh sách của hệ thống timesheet
- **Theme** — Dark/Light mode và 7 màu chủ đạo theo nhận diện thương hiệu OpenWay
- **Export/Import** — Xuất và nhập toàn bộ cấu hình và Preset dưới dạng JSON

---

## 🛠 Cài đặt

### Chrome (khuyến nghị)

1. Tải file `.zip` từ trang [Releases](../../releases/latest) và giải nén
2. Vào `chrome://extensions` → bật **Developer mode**
3. Nhấn **Load unpacked** → chọn thư mục vừa giải nén

### Cài từ source (để dùng `update.bat`)

```bash
git clone git@github.com:tuantoquq/internal-timesheet-ext.git
```

Sau đó load thư mục vừa clone vào Chrome theo hướng dẫn trên.

---

## 📖 Hướng dẫn sử dụng

Extension hỗ trợ 2 chế độ hoạt động tùy theo version:

---

### Chế độ 1 — Fill trên trang (v1.0.3+)

Phù hợp khi muốn kiểm tra lại dữ liệu trên trang trước khi submit thủ công.

**Yêu cầu:**

- Đã đăng nhập sẵn vào hệ thống timesheet trên browser
- Đang mở đúng trang tạo timesheet mới (`TimeSheetEdit.aspx`)

**Các bước:**

1. Vào tab **Presets** → tìm kiếm và lưu các project thường dùng
2. Vào tab **Cài đặt** → thiết lập URL timesheet và giờ mặc định
3. Mở trang `TimeSheetEdit.aspx` trên browser
4. Mở extension → tab **Điền task**
5. Bật các ngày cần điền, chọn Project và nhập nội dung công việc
6. Nhấn **Điền timesheet** — extension sẽ tự động fill dữ liệu vào form trên trang
7. Kiểm tra lại nội dung trên trang rồi nhấn **Update** để lưu

---

### Chế độ 2 — Submit trực tiếp từ extension (v1.1.0+)

Phù hợp khi muốn submit nhanh mà không cần mở trang timesheet.

**Yêu cầu:**

- Chưa cần đăng nhập trên browser — extension tự xử lý

**Thiết lập lần đầu:**

1. Mở extension → nhập URL timesheet, username và password → nhấn **Đăng nhập**
2. Vào tab **Presets** → tìm kiếm và lưu các project thường dùng
3. Vào tab **Cài đặt** → thiết lập giờ mặc định

**Các bước sử dụng hàng tuần:**

1. Mở extension → tab **Điền task**
2. Bật các ngày cần điền, chọn Project và nhập nội dung công việc
3. Nhấn **Submit timesheet** — dữ liệu được lưu thẳng lên server

> **Lưu ý:** Extension tự kiểm tra session mỗi lần mở popup. Nếu phiên đăng nhập hết hạn (thường sau một đêm), extension sẽ cảnh báo và chuyển về màn hình đăng nhập tự động.

---

### Tính năng hỗ trợ chung (cả 2 chế độ)

| Tính năng       | Mô tả                                                       |
| --------------- | ----------------------------------------------------------- |
| **+ Add task**  | Thêm nhiều task trong cùng một ngày                         |
| **Auto time**   | Tự động chia đều giờ khi có nhiều task                      |
| **Apply All**   | Áp dụng cùng project hoặc task cho tất cả các ngày đang bật |
| **Lưu preset**  | Lưu cấu hình tuần hiện tại để tái sử dụng                   |
| **Xoá form**    | Xoá toàn bộ dữ liệu trên extension và trên trang web        |
| **Week Ending** | Tự động tính hoặc chọn thủ công ngày kết thúc tuần          |

---

## 🔄 Cập nhật phiên bản

Extension tự kiểm tra version mới nhất từ `CHANGELOG.md` trên GitHub. Nếu có bản mới, tab **Cài đặt** sẽ hiển thị trạng thái **Update available**.

**Cập nhật tự động (Windows):**

```bat
update.bat
```

Sau khi chạy xong, vào `chrome://extensions` hoặc `about:addons` và nhấn **Reload**.

**Cập nhật thủ công:** Tải file `.xpi` hoặc `.zip` mới nhất từ [Releases](../../releases/latest) và cài đè lên bản cũ.

---

## 📂 Cấu trúc dự án

| File              | Mô tả                                                             |
| ----------------- | ----------------------------------------------------------------- |
| `popup.html/js`   | Giao diện và logic chính của extension                            |
| `popup-core.js`   | Thư viện dùng chung (xử lý thời gian, tìm kiếm project)           |
| `content.js`      | Script chạy trên trang timesheet, thực hiện fill dữ liệu vào form |
| `background.js`   | Service worker xử lý login và submit headless                     |
| `options.html/js` | Trang hướng dẫn sử dụng (mở từ nút ? trong extension)             |
| `CHANGELOG.md`    | Lịch sử phiên bản — dùng để kiểm tra update tự động               |
| `AGENTS.md`       | Hướng dẫn chi tiết dành cho developer                             |

---

## 📄 Bản quyền

Dự án được phát hành dưới [MIT License](LICENSE).

---

_Built with ❤️ for OpenWay by @tuannha_
