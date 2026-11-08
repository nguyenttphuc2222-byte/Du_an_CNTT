# Quản lý năm học học kỳ và bản chốt

Đợt phát triển này tiếp tục từ snapshot `3656ce5`, giữ Node.js HTTP server, SQLite và giao diện JavaScript hiện có. Đối chiếu workspace trước khi sửa: repo con sạch ở mốc trên, nội dung nguồn khớp ZIP sau khi chuẩn hóa xuống dòng. Báo cáo Word và `BAN_GIAO_CHO_AI.md` là tài liệu bối cảnh; lộ trình trong đó không được tính là chức năng đã có.

**Cập nhật sau đợt danh sách và phân công:** quyền cấu hình/chốt/mở kỳ hiện dành cho điều phối viên được khai báo ở máy chủ. Giảng viên thông thường chỉ xử lý lớp được phân công theo kỳ. Kỳ mới cần nhập hoặc sao chép danh sách trước khi ghi kết quả. Các giả định giảng viên quản lý toàn kỳ và giới hạn chưa có phân công bên dưới mô tả đợt học kỳ trước; xem [hướng dẫn phân công hiện hành](DANH_SACH_VA_PHAN_CONG.md) để vận hành phiên bản mới.

Ở snapshot gốc đã có sáu mục điểm, 97 mã tiêu chí/biến thể, hồ sơ đánh giá, kê khai, nhập chính thức, đối soát, báo cáo và chính sách Google Internal/External. Snapshot chỉ hỗ trợ hai học kỳ qua hằng số. Danh mục cấu hình, thời hạn, khóa học kỳ và các lần chốt được bổ sung trong đợt này. `settings.locked` tiếp tục chỉ khóa bộ quy tắc điểm.

## Các giả định nghiệp vụ đang áp dụng

Quy chế được cung cấp không xác định cụ thể quyền chốt/mở hoặc các mốc thời hạn. Ứng dụng dùng các giả định dưới đây để kiểm thử; đây chưa phải quyết định phân quyền của trường.

| Nội dung            | Cách xử lý                                                                                                                                                          |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Người quản lý       | Người dùng có vai trò LECTURER được máy chủ xác nhận có quyền cấu hình, tổng hợp, chốt và mở lại toàn kỳ. Chưa phân công theo lớp/khoa.                             |
| Mở kỳ               | Sinh viên kê khai từ thời điểm bắt đầu, gồm đúng mốc bắt đầu, đến trước hạn kê khai. Để trống mốc tương ứng nghĩa là chưa giới hạn.                                 |
| Hết hạn             | Đúng thời điểm hạn kê khai, máy chủ từ chối kê khai sinh viên. Giảng viên còn được nhập, kiểm tra và đối soát đến khi chốt.                                         |
| Tổng hợp            | Sinh viên dừng kê khai kể cả chưa tới hạn. Giảng viên vẫn được cập nhật.                                                                                            |
| Chốt                | Khóa mọi thao tác thay đổi kết quả của kỳ, kể cả gọi API trực tiếp, dòng nhập trùng và phân loại dữ liệu cũ.                                                        |
| Hồ sơ chưa hoàn tất | Chỉ chốt khi xác nhận rõ và có lý do. Trạng thái không dữ liệu, thiếu dữ liệu, không đánh giá và khoản chờ vẫn được lưu. Kết quả công bố chưa đủ dữ liệu là `null`. |
| Mở lại              | Bắt buộc lý do; giữ bản chốt cũ. Thời hạn cũ vẫn áp dụng; sửa hạn nếu cần nhận kê khai tiếp.                                                                        |
| Chốt lại            | Tạo phiên bản mới, không sửa hoặc thay thế phiên bản trước.                                                                                                         |
| Múi giờ             | Giao diện nhập/hiển thị giờ Việt Nam UTC+7. Máy chủ so sánh thời điểm tuyệt đối, lưu ISO UTC; không tin đồng hồ trình duyệt.                                        |

Luồng trạng thái: **Mở → Tổng hợp → Chốt**, hoặc **Mở → Chốt**. **Chốt → Mở** cần lý do. Mọi chuyển trạng thái đều có người thực hiện, thời điểm và lý do. Nếu muốn hủy giai đoạn tổng hợp thì chốt với xác nhận phù hợp rồi mở lại; ứng dụng chưa có thao tác chuyển trực tiếp Tổng hợp → Mở.

## Danh mục và dữ liệu cũ

Giảng viên thêm kỳ trên trang **Năm học và học kỳ**, không sửa mã nguồn. Năm học gồm hai năm liên tiếp; thứ tự kỳ 1 và 2 là hai vị trí chính để tính năm/toàn khóa. Kỳ bổ sung vẫn dùng được cho nhập liệu và xem riêng nhưng không tự trở thành vị trí chính trong công thức của quy chế. Thiếu một kỳ chính vẫn là thiếu dữ liệu.

Mã kỳ là khóa ổn định, được dùng chung ở bộ chọn kỳ, API, dòng CSV/XLSX/Sheets và báo cáo. Tên hiển thị có thể sửa khi kỳ chưa chốt. Năm/thứ tự đã xác định không được đổi. Migration chỉ thêm bảng danh mục, bản chốt và lịch sử; không thay ID hoặc mã nguồn trong các bảng cũ.

Migration thu thập cả mã kỳ từ cấu hình và các bảng hoạt động, khoản chính thức, kê khai, hồ sơ. Mã cũ không xác định được năm/thứ tự vẫn được giữ, đánh dấu chưa xác minh metadata và không tự đưa vào điểm năm/toàn khóa. Giảng viên xác định metadata rõ ràng một lần trên giao diện, theo căn cứ thực tế.

Một đợt nhập có thể chứa nhiều kỳ. Kỳ đang chọn trên giao diện không thay `semester` trong tệp. Máy chủ kiểm tra từng dòng và kiểm tra lại trong transaction khi ghi; một lỗi khiến toàn đợt không được ghi, không sinh batch hoặc đối soát dở dang. Mẫu XLSX có trang **Hoc ky** ghi danh mục tại lúc tải; máy chủ luôn kiểm tra danh mục/trạng thái hiện tại khi nhập. CSV chỉ có trang dữ liệu nên lấy mã kỳ từ danh mục trên giao diện.

## Bản chốt và nguồn đối chiếu

Mỗi bản chốt giữ kết quả từng sinh viên, tình trạng đầy đủ, hồ sơ, khoản chính thức, kê khai, hoạt động, batch nguồn, roster/lớp, danh mục quy tắc và lịch sử tại thời điểm chốt. Giữ `sourceId`, `canonical`, ID, minh chứng và liên kết đối soát. Có checksum bản chốt, dấu vân tay mã tính điểm và PDF gốc để nhận diện căn cứ nguồn. Tệp minh chứng Drive được lưu bằng tham chiếu, không sao chép nội dung Drive vào SQLite.

Kỳ đã chốt đọc kết quả và danh tính/lớp từ bản lưu; đồng bộ tên Google hoặc phát sinh sinh viên mới không sửa roster lịch sử. Trong API, `officialTotal` giữ số liệu tính toán tương thích phiên bản cũ; với hàng có `snapshotId`, `publishedTotal` là kết quả được công bố và là `null` khi hồ sơ chưa đủ điều kiện kết luận. Giao diện và xuất báo cáo dùng kết quả công bố này. Các cột dự kiến vẫn chỉ phục vụ theo dõi.

Lịch sử và các bản chốt có thể tải JSON trong ứng dụng, dành cho giảng viên. Các bản chốt được chặn sửa/xóa qua API và có trigger SQLite chống UPDATE/DELETE. Checksum hỗ trợ kiểm tra nội dung, không phải chữ ký số hay cơ chế bảo vệ trước người có toàn quyền sửa tệp SQLite.

## API được bổ sung

| Phương thức | Đường dẫn                                  | Phạm vi                                                                     |
| ----------- | ------------------------------------------ | --------------------------------------------------------------------------- |
| GET         | `/api/semesters`                           | Người đã đăng nhập; danh mục, năm học, giờ máy chủ và khả năng ghi hiện tại |
| POST        | `/api/semesters`                           | Giảng viên; tạo kỳ                                                          |
| PATCH       | `/api/semesters/:id`                       | Giảng viên; cấu hình kỳ chưa chốt                                           |
| POST        | `/api/semesters/:id/transition`            | Giảng viên; `action`, `reason`, `acknowledgeIncomplete` khi cần             |
| GET         | `/api/semesters/:id/snapshots`             | Giảng viên; các phiên bản và lịch sử trạng thái                             |
| GET         | `/api/semesters/:id/snapshots/:snapshotId` | Giảng viên; nội dung đầy đủ một bản chốt                                    |

Lỗi quyền dùng 401/403. Xung đột trạng thái, thời hạn hoặc chưa xác nhận hồ sơ thiếu dùng 409. Đợt nhập có dòng lỗi bị từ chối 400 cùng thông tin lỗi. Không dùng dữ liệu vai trò từ trình duyệt để cấp quyền.

## Tự kiểm tra trên giao diện

1. Khởi động ứng dụng bằng cấu hình hiện có, đăng nhập giảng viên. Mở **Năm học và học kỳ → Thêm học kỳ**, tạo năm mới với mã riêng và hạn kê khai. Kỳ mới xuất hiện ở bộ chọn trên cùng và trang báo cáo. Tải mẫu XLSX, mở trang **Hoc ky** để kiểm tra mã mới.
2. Chọn kỳ mới, nhập hồ sơ đánh giá và một khoản CSV/XLSX có `semester` đúng mã đó. Đăng nhập sinh viên trong cửa sổ riêng để kê khai. Điểm chính thức, chờ và dự kiến vẫn hiển thị riêng.
3. Đặt hạn kê khai vừa qua: sinh viên không gửi được; giảng viên vẫn kiểm tra và đối soát được. Chuyển **Tổng hợp** có tác dụng dừng kê khai tương tự, dù hạn chưa tới.
4. Chọn **Chốt và khóa**, nhập lý do. Nếu còn hồ sơ thiếu, lần đầu không xác nhận phải bị từ chối. Xác nhận chốt hồ sơ chưa hoàn tất để tiếp tục; hồ sơ thiếu không có kết luận điểm cuối cùng 0.
5. Thử nhập tệp có một dòng kỳ mở và một dòng kỳ chốt. Toàn đợt phải lỗi và kỳ mở không có dòng mới. Thử sửa hồ sơ, kiểm tra kê khai, đối soát và phân loại dữ liệu cũ thuộc kỳ chốt: đều bị từ chối.
6. Vào **Lịch sử → Tải bản chốt**, kiểm tra nguồn, quy tắc và trạng thái. **Mở lại** với lý do, bổ sung dữ liệu, rồi chốt lần hai. Lịch sử giữ cả phiên bản 1 và 2, cùng lý do mở lại.
7. Khởi động lại ứng dụng bằng cùng nơi lưu dữ liệu: danh mục, trạng thái, lịch sử và các bản chốt phải còn. Không reset DB hay xóa Docker volume.

## Kiểm thử và giới hạn

Chạy trong thư mục có `package.json`:

```powershell
npm run check
npm test
npm run test:browser
npm run test:semesters:browser
```

Các kiểm thử mới dùng SQLite trong bộ nhớ hoặc thư mục tạm, đồng hồ máy chủ giả lập và các phiên demo riêng. Kiểm thử Google hiện có dùng phản hồi mô phỏng; chúng không xác nhận đăng nhập/cấp quyền thật cho `523h0080@student.tdtu.edu.vn` và `nguyenttphuc2222@gmail.com`. Tiếp tục cấu hình Internal/External theo tài liệu hiện có; không cần gửi bí mật cấu hình vào chat.

Kết quả kiểm chứng ngày 6/11/2026: kiểm tra cú pháp đạt; toàn bộ **153/153 ca** nghiệp vụ/API đạt; bộ kiểm thử giao diện hiện có và luồng học kỳ mới đạt trên Edge headless. Có kiểm thử biên thời hạn, khóa các đường ghi, nhập nhiều kỳ nguyên tử, đóng sau preview bằng kết nối khác, chốt lại, snapshot không sửa/xóa, bảo toàn danh tính và dữ liệu qua migration/restart. Nhật ký nghiệp vụ/API tại `artifacts/semester-lifecycle/tests.txt`; ảnh giao diện kiểm thử tại cùng thư mục.

Chưa bổ sung quyền hội đồng/quản trị riêng, khóa theo lớp, phúc tra, thông báo thời hạn, ký số hoặc bản chốt riêng cho năm/toàn khóa. Báo cáo năm/toàn khóa tổng hợp các kết quả kỳ trong danh mục; không tự ban hành quyết định học vụ. Chưa triển khai lên môi trường trường hoặc xác nhận với tài khoản Google thật. Không mở/migrate DB vận hành, không xóa volume và không đẩy mã lên GitHub trong đợt kiểm thử này.
