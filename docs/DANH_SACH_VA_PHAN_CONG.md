# Danh sách sinh viên và phân công giảng viên theo học kỳ

Đợt này triển khai **ưu tiên 2 trong mục 8 của báo cáo bàn giao**: nhập danh sách lớp, khoa, khóa tuyển sinh; lưu lớp theo từng kỳ; phân công giảng viên và kiểm tra phạm vi ở backend. Tiếp tục dùng kiến trúc, dữ liệu và phần chốt học kỳ đã có; không viết lại ứng dụng.

Ưu tiên 1 đã được triển khai ở đợt trước, có hướng dẫn tại [Quản lý học kỳ](QUAN_LY_HOC_KY.md). Ưu tiên 3 về phúc tra/điều chỉnh, ưu tiên 4 về thông báo và ưu tiên 5 về vận hành thực tế chưa được tính là đã hoàn thành. Chia sẻ minh chứng mới được điều chỉnh trong đợt này vì phải tuân theo phạm vi phân công.

## Quyền đã được người dùng chọn

Hai điều phối viên: **nguyenttphuc2005@gmail.com** và **son417502@gmail.com**. Địa chỉ này được khai báo qua `COORDINATOR_EMAILS`, không lấy quyền từ dữ liệu trình duyệt. Tài khoản còn phải được backend xác nhận có vai trò `LECTURER`; chỉ có email trong danh sách điều phối không biến một sinh viên thành giảng viên.

```dotenv
COORDINATOR_EMAILS=nguyenttphuc2005@gmail.com,son417502@gmail.com
```

Với External, hai email cũng được thêm vào `LECTURER_EMAILS`, đồng thời giữ những giảng viên đã cấu hình trước. Email `nguyenttphuc2222@gmail.com` tiếp tục là giảng viên thông thường, cần được phân công lớp. Chế độ Internal/External và các thông tin OAuth khác được giữ nguyên. `.env.example` và Compose đã có biến điều phối; `.env` cục bộ chỉ được cập nhật hai khóa email này, không thay Client ID/Secret hoặc các cấu hình khác.

| Người dùng              | Phạm vi                                                                                                                                                    |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Điều phối viên          | Quản lý danh sách, phân công/thu hồi, cấu hình/chốt/mở kỳ, quy tắc hỗ trợ, nhật ký toàn hệ thống và tải bản chốt đầy đủ.                                   |
| Giảng viên thông thường | Xem và xử lý sinh viên thuộc lớp được giao trong đúng học kỳ. Báo cáo năm/toàn khóa kiểm tra quyền riêng từng kỳ; kỳ ngoài phạm vi không cung cấp điểm ẩn. |
| Sinh viên               | Xem hồ sơ và lịch sử của mình; chỉ kê khai khi đã có danh sách kỳ đó và kỳ/thời hạn cho phép.                                                              |

Giảng viên mới cần đăng nhập một lần để có định danh xác thực trong ứng dụng trước khi điều phối viên chọn phân công. Vai trò Google vẫn tuân theo chính sách hiện có. Ngoại lệ điều phối viên demo chỉ dành cho ID demo đã công bố khi môi trường bật demo rõ ràng; không được sử dụng để cấp quyền cho phiên Google thật.

## Lớp theo từng kỳ và danh tính

Lớp, khoa và năm tuyển sinh thuộc bản ghi ghi danh `(studentId, semester)`. Chuyển lớp trong HK2 không đổi lớp ở HK1, ID sinh viên, mã nguồn điểm hoặc liên kết đối soát. Khoa/khóa chưa có căn cứ được để chưa xác định; không suy ra từ MSSV hoặc email.

Kỳ mới có danh sách trống. Điều phối viên nhập danh sách hoặc chọn **Sao chép danh sách** từ kỳ có dữ liệu. Sao chép chỉ cho phép kỳ đích còn trống và chưa chốt; không sao chép điểm, đánh giá hoặc phân công. Nếu kỳ đích đã có danh sách, dùng các dòng nhập điều chỉnh có nguồn mới và lý do, tránh ghi đè hàng loạt công việc đã làm.

Nhập danh sách đối chiếu chính xác MSSV và email. Nếu email đã thuộc MSSV khác, hoặc MSSV đã gắn email khác, toàn đợt bị từ chối. Ứng dụng không tự ghép hồ sơ Google, đổi ID, di chuyển điểm hoặc sửa định danh để làm cho tệp nhập khớp. Trường hợp xung đột danh tính cần đối chiếu riêng; đợt này chưa có quy trình hợp nhất hồ sơ.

Tên Google của hồ sơ đã liên kết tiếp tục được đồng bộ theo chính sách hiện có; tên trong nguồn nhập không ghi đè tên Google. Nguồn nhập vẫn giữ đầy đủ nội dung và căn cứ đã gửi. Trong kỳ chốt, roster và tên/lớp được đọc từ snapshot, không dùng tên mới để sửa báo cáo lịch sử.

Migration bổ sung bảng ghi danh, nguồn/đợt nhập danh sách, lịch sử và phân công. Migration chỉ chụp danh sách đang có một lần cho các kỳ đã tồn tại, ghi rõ nguồn gốc là dữ liệu tại thời điểm nâng cấp; không khẳng định đó là lịch sử lớp đã được nhà trường xác nhận. Bản chốt cũ không bị sửa. Chạy lại migration không nhân đôi; kỳ tạo sau migration không tự nhận sinh viên.

## Nhập CSV và Excel

Tải mẫu tại **Danh sách và phân công → Nhập danh sách → Mẫu Excel/Mẫu CSV**. XLSX có trang dữ liệu, hướng dẫn và danh mục học kỳ hiện hành. Đây là mẫu danh sách, tách với mẫu khoản điểm chính thức.

| Cột                     | Ý nghĩa                                                                                    |
| ----------------------- | ------------------------------------------------------------------------------------------ |
| `sourceId`              | Mã dòng nguồn duy nhất trong học kỳ; giữ khi nhập lại cùng dữ liệu.                        |
| `studentCode`, `email`  | MSSV và email chính xác của cùng hồ sơ. Đặt mã dạng văn bản để giữ số 0 đầu.               |
| `name`                  | Tên trong danh sách nguồn.                                                                 |
| `classId`, `className`  | Mã và tên lớp; phải có giá trị. Mã đã tồn tại không được gắn tên khác bằng nhập danh sách. |
| `faculty`, `cohortYear` | Khoa và năm tuyển sinh; để trống khi chưa xác định.                                        |
| `semester`              | Mã kỳ của từng dòng; không bị kỳ đang chọn trên giao diện ghi đè.                          |
| `approvalReference`     | Tham chiếu danh sách/văn bản làm căn cứ.                                                   |

Mỗi dòng là thông tin đầy đủ của ghi danh trong kỳ đó. Để trống khoa/khóa khi điều chỉnh sẽ lưu trạng thái chưa xác định, không tự kế thừa giá trị cũ. Dữ liệu trước/sau vẫn được lưu trong lịch sử.

Giữ nguyên `sourceId` khi nhập lại cùng dữ liệu: hệ thống bỏ qua và không lặp nguồn. Cùng mã nhưng nội dung khác là xung đột; sửa có căn cứ dùng dòng nguồn điều chỉnh mới và lý do. Nguồn cũ không bị ghi đè. Không dùng mã nguồn danh sách thay mã nguồn khoản điểm.

Tệp có thể chứa nhiều kỳ. Xem trước kiểm tra từng dòng, sau đó máy chủ kiểm tra lại trong transaction khi ghi. Một dòng xung đột hoặc thuộc kỳ chốt khiến toàn bộ đợt bị từ chối, kể cả các dòng hợp lệ thuộc kỳ khác. Không nhận công thức Excel; dùng chung giới hạn tệp và kiểm tra ZIP với bộ nhập điểm hiện có.

## Nhập trực tiếp từ Google Sheets

Điều phối viên đăng nhập bằng Google, kết nối Workspace và mở **Danh sách và phân công → Nhập từ Google Sheets**. Tài khoản cần quyền đọc tệp. Dùng hàng tiêu đề của mẫu danh sách ở dòng 1 và định dạng các cột mã dưới dạng văn bản. Chọn một học kỳ chưa chốt, dán liên kết và điền tên trang tính nếu muốn chọn một trang cụ thể. Tên trang tính được ưu tiên, sau đó đến mã trang trong liên kết. Nếu không có cả hai, hệ thống đọc trang đầu tiên.

Mã học kỳ trên mọi dòng phải khớp kỳ đã chọn. Xem trước hiện số dòng thực tế trên trang tính, lỗi định danh và thông tin ghi danh mới hoặc thay đổi dự kiến. Trang tính chứa công thức không được nhập. Nếu có dòng lỗi, sửa nguồn và xem trước lại trước khi xác nhận.

Khi xác nhận, máy chủ đọc lại trang tính, kiểm tra danh sách đích, quyền và khóa kỳ. Nếu nguồn hoặc dữ liệu liên quan thay đổi sau lúc xem trước, thực hiện lại bước xem trước. Hệ thống chỉ ghi khi cả đợt hợp lệ. Lịch sử của điều phối viên lưu liên kết nguồn, trang tính và số dòng cùng mã nguồn và lý do đã nhập.

API dành cho điều phối viên gồm `POST /api/roster/sheets/preview` và `POST /api/roster/sheets/commit`. Kiểm thử dùng tài khoản và phản hồi Google mô phỏng. Để thử với Google thật, dùng một bảng minh họa đã cấp quyền đọc cho tài khoản điều phối.

## Phân công và khóa học kỳ

Phân công có giảng viên, lớp, kỳ, người thực hiện, thời điểm và lý do. Thu hồi giữ phân công cũ cùng thời điểm/người thu hồi và lý do. Phân công mới sau thu hồi tạo bản ghi riêng, không tái sử dụng lịch sử cũ. Không cho giảng viên tự cấp lớp cho mình.

Kiểm tra backend áp dụng cho dashboard, danh sách, đánh giá theo ID, kê khai/kiểm tra, nhập điểm từng dòng, đối soát, phân loại dữ liệu cũ, báo cáo và xuất CSV/XLSX/Sheets. Không chỉ lọc giao diện. Bản chốt đầy đủ và nhật ký cũ chứa dữ liệu nhiều lớp nên chỉ điều phối viên đọc được. Giảng viên chỉ nhận dữ liệu batch trong phạm vi phù hợp; các lớp/kỳ khác không lộ qua metadata.

Theo giả định triển khai hiện tại, điều phối viên có thể thay phân công ở kỳ chốt để bàn giao hoặc thu hồi quyền đọc mà **không mở lại điểm**. Thao tác có lý do và nhật ký; snapshot giữ nguyên phân công/lịch sử tại lúc chốt. Quyền đọc hiện tại tra theo phân công hiện hành, còn lớp và kết quả lịch sử tra theo kỳ/snapshot. Mọi thao tác thay đổi kết quả hoặc roster vẫn bị khóa như trước.

Lịch sử chuyển lớp chỉ hiển thị thông tin thuộc phạm vi giảng viên. Phần trước thuộc lớp ngoài phạm vi được ghi **Ngoài phạm vi phân công**; không giả thành chưa có lịch sử. Điều phối viên và chính sinh viên được xem lịch sử đầy đủ của hồ sơ.

## Minh chứng Drive

Tệp mới lấy danh sách nhận chia sẻ từ giảng viên đang phụ trách lớp trong kỳ và các điều phối viên có vai trò hợp lệ. Không dùng toàn bộ `LECTURER_EMAILS` làm danh sách chia sẻ. Trước khi tải, backend kiểm tra hồ sơ, ghi danh, phạm vi và thời hạn. Trong quá trình tải/chia sẻ bất đồng bộ, quyền được kiểm tra lại; thay đổi phân công không được âm thầm coi là chia sẻ thành công.

Nếu tải được nhưng chưa chia sẻ đủ hoặc chính sách thay đổi, giao diện nhận cảnh báo và giữ liên kết tệp. Không biến bước kiểm tra/chia sẻ minh chứng thành điểm chính thức. Việc sửa quyền mới tạo do thay đổi đồng thời là cố gắng khắc phục, không phải transaction chung giữa Google và SQLite.

Các quyền Drive đã cấp trước đây **không tự bị thu hồi** khi thu hồi phân công trong ứng dụng. Chủ tệp hoặc quản trị viên cần kiểm tra trực tiếp trên Drive. Kiểm thử mô phỏng không chứng minh tài khoản thật đã cấp quyền hoặc trường cho phép chia sẻ tới Gmail.

## Tự kiểm tra

1. Khởi động lại Node, hoặc dựng lại container bằng `docker compose up -d --build` để nhận cấu hình email mới. Đăng nhập lại bằng một trong hai email điều phối. Không xóa volume. Với DB cũ, migration bổ sung chạy khi mở cùng DB; bộ dữ liệu khởi tạo mới vẫn là dữ liệu demo.
2. Cho giảng viên `nguyenttphuc2222@gmail.com` đăng nhập một lần. Tài khoản chưa phân công không được thấy toàn bộ sinh viên hoặc các nút quản trị toàn hệ thống.
3. Điều phối viên vào **Danh sách và phân công**, tải mẫu và nhập một danh sách có khoa/khóa có căn cứ. Thử một dòng sai email: cả đợt phải lỗi. Nhập lại cùng nguồn: phải bỏ qua, không sinh bản sao sinh viên.
4. Tạo kỳ mới ở **Năm học và học kỳ**. Danh sách ban đầu trống; dùng **Sao chép danh sách** hoặc nhập nguồn cho kỳ mới. Không có điểm hay phân công tự chuyển theo.
5. Chọn **Phân công giảng viên**, chọn lớp và giảng viên, ghi lý do. Giảng viên tải lại trang chỉ thấy lớp đó trong đúng kỳ. Thử gọi API theo ID sinh viên lớp khác: phải bị từ chối.
6. Nhập một dòng nguồn mới để chuyển sinh viên sang lớp khác ở kỳ mới. Kiểm tra kỳ cũ và bản chốt cũ vẫn giữ lớp cũ; **Lịch sử** có dữ liệu trước/sau và lý do. Quyền giảng viên thay đổi theo lớp thực tế trong kỳ.
7. Chốt kỳ, thử sửa roster/điểm: bị từ chối. Điều phối viên vẫn thu hồi phân công được; giảng viên đang đăng nhập mất quyền sau khi tải lại/gọi API, snapshot và điểm không đổi.
8. Kiểm tra minh chứng bằng Google thật riêng sau khi cấp quyền: người được chia sẻ đúng người phụ trách, lỗi chia sẻ hiển thị rõ. Kiểm tra các tệp cũ trực tiếp trên Drive vì quyền cũ không bị thu hồi tự động.

## Kiểm thử và phạm vi còn lại

```powershell
npm run check
npm test
npm run test:browser
npm run test:semesters:browser
npm run test:roster:browser
```

Các kiểm thử dùng SQLite trong bộ nhớ/thư mục tạm và phản hồi Google mô phỏng. Không mở DB vận hành trong quá trình chạy kiểm thử, không reset dữ liệu, không xóa volume và không push lên GitHub. Nhật ký và ảnh thử tại `artifacts/roadmap-roster`.

Kết quả ngày **8/11/2026**: kiểm tra cú pháp đạt; **174/174 ca** nghiệp vụ/API/parser đạt; cả ba bộ kiểm thử giao diện hiện có, học kỳ và danh sách/phân công đều đạt trên Edge headless. Có kiểm thử hai email điều phối đã chọn bằng Google mô phỏng; kiểm tra quyền giả mạo, lớp ngoài phạm vi, kỳ khác, đợt nhập nhiều dòng, xung đột danh tính, migration/restart, snapshot bất biến và đổi quyền trong lúc tải/chia sẻ minh chứng.

API mới: `GET /api/access`, `GET /api/roster`, `GET /api/roster/history`, `POST /api/roster/preview`, `POST /api/roster/commit`, `POST /api/roster/copy`, `GET /api/roster/template.xlsx` hoặc `.csv`, `GET /api/lecturers`, `GET/POST /api/assignments`, `POST /api/assignments/:id/revoke`. Các thao tác ghi roster/phân công đều được kiểm tra quyền thực tế ở store, ngoài kiểm tra ở HTTP.

Các bước phát triển tiếp theo gồm quy trình xử lý xung đột danh tính, nghiệm thu Google thật, chạy CI trên GitHub và thử tải với lớp thực tế. Phúc tra, điều chỉnh, minh chứng và thông báo được mô tả trong [hướng dẫn riêng](PHUC_TRA_MINH_CHUNG_THONG_BAO.md).
