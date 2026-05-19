# Changelog

## [1.1.2] - 2026-05-19

### Added

- Hiển thị trạng thái `Approved` / `New` từ timesheet detail trên từng ngày trong form extension.
- Khóa chỉnh sửa các ngày đã `Approved` và vô hiệu hoá submit/xoá form khi toàn bộ ngày có dữ liệu đều đã approved.
- Footer author `@tuannha` trỏ tới GitHub profile.

### Fixed

- Parse status trong detail page ổn định hơn cho các dòng HTML bị thiếu closing tag, đặc biệt Tuesday.
- Hoàn thiện headless multi-task submit bằng cách tạo đủ server rows trước khi update timesheet.
- Đồng bộ payload multi-task với format thực tế của hệ thống timesheet.
- Style disabled cho nút Xoá form để phản ánh đúng trạng thái bị khóa.

---

## [1.1.1] - 2026-05-19

### Added

- Tự động tìm timesheet record đã tồn tại theo Week Ending trước khi submit để cập nhật record cũ thay vì tạo trùng.
- Load dữ liệu từ timesheet detail hiện có vào form extension khi chọn Week Ending đã có record.
- Loading overlay bán trong suốt khi extension đang tải dữ liệu timesheet detail.

### Fixed

- Sửa submit nhiều task trong cùng một ngày cho headless flow: tạo đủ server rows trước khi update và gửi đúng `hdf<day>` row list.
- Match payload update của hệ thống timesheet với double-encoded values và định dạng row suffix `0*1*`.
- Reset form khi đổi Week Ending nếu không tìm thấy timesheet tương ứng, tránh giữ dữ liệu của tuần trước.
- Sửa loading screen ban đầu bị ẩn do nằm trong `appScreen` đang `screen-hidden`.

---

## [1.1.0] - 2026-05-19

### Added

- Đăng nhập trực tiếp từ extension — không cần mở browser vào trang timesheet
- Submit timesheet headless — lưu dữ liệu lên server ngay từ popup/tab view mà không cần thao tác thủ công trên trang
- Tự động kiểm tra session khi mở popup, cảnh báo và chuyển về màn hình đăng nhập nếu phiên đã hết hạn
- Màn hình đăng nhập tích hợp với URL timesheet có thể cấu hình

### Improved

- Layout popup và tab view: header, tab bar và footer cố định, phần nội dung scroll độc lập
- Footer chỉ hiển thị các nút Xoá form / Lưu preset / Submit ở tab Điền task, ẩn ở các tab khác

---

## [1.0.3] - 2026-05-18

### Added

- Hỗ trợ nhiều task trong cùng một ngày — nhấn `+ Add task` để thêm row
- Nút **Auto time** tự động chia đều giờ làm khi có nhiều task trong ngày
- Nút **Apply All** để áp dụng cùng project hoặc nội dung task cho tất cả các ngày đang bật

### Fixed

- Xử lý đúng row ID do server sinh ra không theo thứ tự tuần tự (trmon_0, trmon_2, trmon_3...) — tránh tạo thừa row hoặc fill sai field
- Selector field name chính xác: `monTask0` (không có underscore) vs `monProject_0` (có underscore)
- Chờ DOM cập nhật đúng sau khi click nút `+` thay vì dùng timeout cố định

---

## [1.0.2] - 2026-05-15

### Fixed

- Footer bị che khuất trong popup — nút Điền timesheet không hiển thị đủ
- Sửa layout `body` từ `max-height` sang `height` cố định kết hợp `flex: 1 1 0; min-height: 0` cho scroll area

---

## [1.0.1] - 2026-05-15

### Fixed

- Version badge hiển thị sai hoặc không hiển thị trên header và product footer
- Đọc version động từ `chrome.runtime.getManifest()` thay vì hardcode

---

## [1.0.0] - 2026-05-15

### Added

- Giao diện popup và tab view với dark/light mode và 7 màu chủ đạo tuỳ chỉnh
- Auto fill project, task, start/break/finish time cho tất cả 7 ngày trong tuần
- Giờ mặc định toàn tuần (09:00 / 01:30 / 18:30) có thể override riêng từng task
- Hệ thống Preset — lưu và tái sử dụng cấu hình task thường dùng
- Tìm kiếm và lưu project từ danh sách của hệ thống timesheet
- Export/import config dạng JSON
- Kiểm tra cập nhật tự động từ GitHub CHANGELOG
- Hướng dẫn cập nhật qua `update.bat`
