# Phúc tra điều chỉnh minh chứng và thông báo

Đợt cập nhật này bổ sung **phúc tra và điều chỉnh** cùng **minh chứng và thông báo** trong lộ trình bàn giao. Sinh viên gửi yêu cầu theo dữ liệu thực tế; người phụ trách xử lý có căn cứ và lịch sử trước sau. Tệp minh chứng có trạng thái được lưu, còn thông báo tiến độ và thời hạn được giữ trong ứng dụng.

Các nguyên tắc tính điểm, sáu mục và danh mục tiêu chí hiện hành được giữ nguyên. Gửi yêu cầu, tải tệp, chia sẻ tệp hoặc kiểm tra minh chứng không tự cấp điểm chính thức. Phân quyền theo lớp/học kỳ và khóa kết quả ở backend tiếp tục được áp dụng.

## Phúc tra theo khoản hoặc đánh giá học kỳ

Sinh viên có tên trong danh sách kỳ được gửi yêu cầu cho một trong ba loại dữ liệu của mình:

| Loại yêu cầu                      | Cách xử lý khi chấp thuận                                                                                                  |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Khoản điểm chính thức có hiệu lực | Ghi khoản mới có nguồn và căn cứ để thay thế khoản gốc. Chỉ khoản có hiệu lực góp vào điểm hiện tại.                       |
| Đánh giá học kỳ                   | Cập nhật dữ liệu đánh giá đã xác nhận như GPA, chấp hành, hoạt động trực tiếp hoặc chế độ học kỳ; lưu đầy đủ trước và sau. |
| Kê khai chưa đối soát             | Kiểm tra lại kê khai và chuyển trạng thái phù hợp. Không tự cấp điểm chính thức; vẫn cần nguồn nhập và đối soát riêng.     |

Kê khai đã đối soát không được mở phúc tra như kê khai chưa có kết quả. Sinh viên chọn khoản chính thức có hiệu lực tương ứng để đề nghị đối chiếu. Khoản chính thức đã có khoản thay thế cũng không được dùng để điều chỉnh lại như một khoản đang có hiệu lực.

Luồng yêu cầu gồm **Đang chờ xử lý → Cần bổ sung → Đã xử lý chấp thuận hoặc Không chấp thuận**. Sinh viên có thể bổ sung hoặc rút yêu cầu đang mở; yêu cầu kết thúc không được ghi đè. Mỗi hành động lưu người thực hiện, thời điểm, lý do và dữ liệu liên quan.

Giảng viên phụ trách đúng lớp/kỳ hoặc điều phối viên được xử lý. Chấp thuận phải có **lý do và tham chiếu văn bản hoặc nguồn xác nhận**. Thông tin do sinh viên đề nghị không được dùng làm quyền duyệt hoặc số điểm tự động. Backend vẫn kiểm tra tiêu chí, định mức, số lượng, điều kiện chế độ học kỳ và các giới hạn theo quy chế.

Một khoản không được có nhiều yêu cầu đang mở cùng lúc. Trước khi chấp thuận, máy chủ so sánh dữ liệu hiện hành với lúc gửi yêu cầu. Nếu khoản đã thay đổi do một thao tác khác, hệ thống từ chối điều chỉnh trên dữ liệu cũ; cần đối chiếu, kết thúc yêu cầu cũ phù hợp và gửi yêu cầu cho dữ liệu hiện hành.

## Điều chỉnh giữ nguồn gốc và không cộng trùng

Khoản gốc giữ nguyên ID, `sourceId`, dữ liệu nguồn chuẩn hóa và liên kết đối soát đã có. Khoản thay thế có ID/mã nguồn mới và quan hệ thay thế rõ ràng. Nếu có nhiều lần điều chỉnh liên tiếp, chỉ khoản cuối còn hiệu lực được tính; không cộng cả khoản gốc lẫn các khoản đã bị thay thế.

Giao diện gắn nhãn khoản đã thay thế và gạch điểm ở dòng lịch sử đó để tránh hiểu nhầm là vẫn cộng vào tổng. Liên kết đối soát từ khoản gốc được giữ để truy vết; nhãn **Liên kết khoản gốc** phân biệt với liên kết trực tiếp của khoản mới. Không đổi mã nguồn cũ để làm cho một tệp nhập trở thành dữ liệu mới.

Chi tiết phúc tra hiển thị kết luận cùng dữ liệu trước/sau, người xử lý, thời điểm, lý do và căn cứ. Các bản chốt trước đó giữ nguyên; thay đổi sau khi mở lại chỉ xuất hiện trong kết quả hiện hành và lần chốt mới.

## Phúc tra khi đã hết hạn hoặc kỳ đã chốt

Hạn kê khai và khóa điểm không ngăn sinh viên gửi yêu cầu phúc tra hoặc bổ sung vào yêu cầu đang mở. Những thao tác này chưa thay đổi kết quả. Giảng viên vẫn có thể yêu cầu bổ sung hoặc ghi nhận không chấp thuận khi kỳ đã chốt.

Mọi chấp thuận làm thay đổi dữ liệu kết quả phải qua kiểm tra khóa ở backend. Điều phối viên cần mở lại kỳ với lý do trước khi áp dụng điều chỉnh; sau đó chốt lại tạo bản lưu mới. Không dùng thao tác phúc tra để vượt khóa kỳ.

Ứng dụng chưa đặt một thời hạn phúc tra riêng theo quy định trường. Quyền gửi vẫn phụ thuộc danh tính, danh sách học kỳ và trạng thái yêu cầu. Khi có quy trình chính thức, cần bổ sung thời hạn và cấp duyệt tương ứng bằng quyết định nghiệp vụ rõ ràng.

## Trạng thái minh chứng được lưu

Tệp được tải từ biểu mẫu kê khai hoặc từ phần bổ sung của một yêu cầu phúc tra đã tạo. Minh chứng phúc tra gắn với đúng yêu cầu đang mở; không dùng mã tệp của người khác, kỳ khác hoặc yêu cầu khác để gắn vào hồ sơ.

| Trạng thái                   | Ý nghĩa                                                                                |
| ---------------------------- | -------------------------------------------------------------------------------------- |
| Đang tải lên                 | Máy chủ đã tạo hồ sơ theo dõi và đang xử lý tệp.                                       |
| Đã tải chưa hoàn tất chia sẻ | Tệp đã có nhưng chưa có kết luận hoàn tất chia sẻ.                                     |
| Đã chia sẻ                   | Lượt xử lý đã ghi nhận đủ người nhận theo phạm vi hiện hành.                           |
| Chia sẻ chưa hoàn tất        | Tệp có thể đã tải thành công nhưng còn lỗi hoặc thiếu quyền.                           |
| Cần cập nhật người nhận      | Phân công/phạm vi đã thay đổi hoặc có yêu cầu chủ tệp kiểm tra lại.                    |
| Tải lên không thành công     | Chưa hoàn tất tạo tệp; nếu chưa có mã Drive, người dùng cần chọn và tải lại tệp nguồn. |

Hồ sơ tệp giữ chủ tệp, sinh viên, học kỳ, mục đích, mã Drive, tên/định dạng/kích thước, checksum và lịch sử trạng thái. Chỉ nhận PDF, PNG, JPEG hoặc WEBP tối đa 5 MB; nội dung phải khớp dấu hiệu định dạng. Không lưu tệp nhị phân Google vào cơ sở dữ liệu điểm.

Liên kết minh chứng tự nhập hoặc đã có từ trước vẫn được giữ ở hồ sơ nguồn. Nếu chưa có bản ghi theo dõi, giao diện ghi rõ quyền chia sẻ chưa được xác nhận; không suy ra rằng một URL Drive đang hoạt động là đã chia sẻ đủ cho người phụ trách.

## Đồng bộ quyền Drive theo người phụ trách

Người nhận được tính từ giảng viên đang phụ trách lớp trong đúng kỳ và điều phối viên có vai trò hợp lệ. Ứng dụng không chia sẻ cho toàn bộ danh sách giảng viên chỉ vì có tên trong cấu hình đăng nhập.

Máy chủ kiểm tra lại quyền khi tải và chia sẻ đang chờ phản hồi. Nếu phân công, phiên hoặc thời hạn thay đổi, hệ thống không được âm thầm báo hoàn tất. Trạng thái lỗi, người nhận chưa được cấp quyền và trường hợp cần kiểm tra thu hồi được lưu để chủ tệp xử lý.

Trong **Minh chứng → Xem trạng thái**, chủ tệp Google có thể chọn **Đồng bộ quyền chia sẻ**. Thao tác cần đúng tài khoản đã tải tệp và kết nối Workspace còn hiệu lực. Máy chủ đọc quyền thực tế đang có, cấp cho người phụ trách hiện tại và chỉ thu hồi những quyền cũ do ứng dụng tạo, có mã quyền và người nhận được theo dõi nhất quán.

Quyền chia sẻ thủ công hoặc không có lịch sử quản lý trong ứng dụng không bị tự xóa. Nếu quyền đã bị thay đổi ngoài ứng dụng, không đủ căn cứ nhận diện, hoặc Google từ chối thao tác, hệ thống giữ cảnh báo để chủ tệp kiểm tra trực tiếp trên Drive. Không thể coi Google và SQLite là một transaction duy nhất.

Sửa quyền cho tệp đã biết có thể thực hiện cả khi kỳ đã chốt vì không sửa nội dung tệp hoặc kết quả điểm. Tải minh chứng mới cho kê khai thông thường vẫn chịu hạn kê khai và khóa kỳ. Minh chứng bổ sung cho phúc tra phải đi qua một yêu cầu đang mở; không dùng cờ mục đích để vượt kiểm tra hồ sơ.

Giảng viên có thể chọn **Nhắc chủ tệp kiểm tra chia sẻ**. Đây là thông báo trong ứng dụng đến chủ tệp, không tự dùng tài khoản giảng viên để thay quyền Drive của sinh viên.

## Thông báo trong ứng dụng

Thông báo phản ánh các cập nhật có liên quan như yêu cầu phúc tra mới, yêu cầu bổ sung/kết luận, trạng thái minh chứng, cập nhật kê khai/kết quả và thay đổi học kỳ. Trạng thái đã đọc được lưu trong SQLite và giữ khi đăng nhập lại.

Ngưỡng nhắc hạn hiện tại là **24 giờ trước hạn kê khai** và một thông báo khi đã hết hạn. Thời gian được tính bằng đồng hồ máy chủ; nội dung nhắc được chống trùng theo sự kiện/mốc hạn. Đổi hạn tạo mốc theo dõi mới, không phát lại vô hạn cùng một thông báo.

Máy chủ đang chạy kiểm tra nhắc hạn định kỳ **60 giây**. Giao diện đang mở kiểm tra thông báo mỗi **30 giây**, đồng thời cập nhật khi người dùng truy cập các trang phù hợp. Nếu ứng dụng hoặc máy chủ không chạy, không có cam kết nhắc theo thời gian thực; khi hoạt động trở lại, hệ thống đối chiếu lại các mốc cần thông báo.

Chỉ chủ tài khoản được đánh dấu thông báo của mình đã đọc. Nội dung hiển thị còn phải thuộc phạm vi hiện tại: giảng viên đã bị thu hồi lớp không được dùng thông báo cũ để xem lại dữ liệu ngoài quyền. Thông báo dẫn về trang/phần nội dung tương ứng thay vì thay thế kiểm tra quyền của API.

Đợt này **không gửi email, SMS, thông báo đẩy hoặc tin nhắn bên ngoài**. Các kênh đó cần thiết kế đăng ký nhận, vận hành và thử nghiệm riêng.

## Các API bổ sung

| API                                        | Phạm vi và mục đích                                                          |
| ------------------------------------------ | ---------------------------------------------------------------------------- |
| `GET/POST /api/appeals`                    | Danh sách trong phạm vi; sinh viên tạo yêu cầu của mình.                     |
| `GET /api/appeals/:id`                     | Chi tiết, lịch sử và dữ liệu điều chỉnh nếu có.                              |
| `POST /api/appeals/:id/respond`            | Sinh viên bổ sung hoặc rút yêu cầu đang mở.                                  |
| `POST /api/appeals/:id/resolve`            | Người phụ trách yêu cầu bổ sung, không chấp thuận hoặc chấp thuận có căn cứ. |
| `GET /api/evidence` và `/api/evidence/:id` | Danh sách/trạng thái tệp trong phạm vi.                                      |
| `POST /api/google/evidence`                | Tải minh chứng, kiểm tra phạm vi và lưu hồ sơ theo dõi.                      |
| `POST /api/evidence/:id/retry`             | Chủ tệp đồng bộ chia sẻ bằng kết nối Google của mình.                        |
| `POST /api/evidence/:id/request-share`     | Gửi nhắc chủ tệp kiểm tra chia sẻ trong ứng dụng.                            |
| `GET /api/notifications`                   | Danh sách và số chưa đọc còn thuộc quyền của tài khoản.                      |
| `PATCH /api/notifications/:id/read`        | Đánh dấu thông báo của mình đã đọc.                                          |
| `POST /api/notifications/read-all`         | Đánh dấu các thông báo nhìn thấy của mình đã đọc.                            |

Các API cập nhật phúc tra còn nhận `PATCH /api/appeals/:id` theo cùng kiểm tra trong store. Đường dẫn hoặc thao tác gửi từ trình duyệt không tự quyết định quyền; vai trò, phân công, chủ sở hữu, học kỳ và trạng thái được kiểm tra tại backend.

## Tự kiểm tra trên giao diện

1. Khởi động lại ứng dụng bằng cấu hình hiện có, đăng nhập sinh viên. Vào **Phúc tra và điều chỉnh → Gửi yêu cầu**, chọn khoản chính thức hoặc đánh giá học kỳ của mình, ghi lý do và gửi. Điểm phải còn nguyên.
2. Đăng nhập giảng viên đã được phân công đúng kỳ hoặc điều phối viên. Mở yêu cầu, chọn **Yêu cầu bổ sung**; kiểm tra sinh viên nhận thông báo và thấy lịch sử phản hồi.
3. Sinh viên mở yêu cầu, bổ sung nội dung và minh chứng. Với tệp mới, kết nối đúng Google, tải tệp, kiểm tra trạng thái rồi gửi phần bổ sung. Tệp đã tải nhưng lỗi chia sẻ phải có cảnh báo, không được báo hoàn tất.
4. Người phụ trách chọn **Điều chỉnh có căn cứ**. Với khoản chính thức, nhập mã nguồn mới, tiêu chí/giá trị đúng và tham chiếu phê duyệt; xác nhận lý do. Kiểm tra khoản gốc còn trong lịch sử và không cộng cùng khoản thay thế.
5. Với phúc tra kê khai, thử chấp thuận kiểm tra lại: trạng thái kê khai có thể đổi nhưng điểm chính thức chưa được cấp. Với kê khai đã đối soát, chọn khoản chính thức có hiệu lực để phúc tra.
6. Chốt kỳ rồi thử gửi phúc tra: yêu cầu vẫn được ghi nhận. Thử chấp thuận điều chỉnh khi kỳ còn chốt: phải bị chặn. Điều phối viên mở lại có lý do, xử lý rồi chốt mới; bản chốt cũ giữ nguyên.
7. Vào **Minh chứng**, mở tệp bằng tài khoản chủ tệp và chọn **Đồng bộ quyền chia sẻ** sau khi đổi phân công. Kiểm tra người phụ trách hiện tại, quyền ứng dụng cũ cần thu hồi và các cảnh báo. Quyền chia sẻ thủ công cần được chủ tệp kiểm tra riêng.
8. Vào **Thông báo**, mở nội dung liên quan hoặc đánh dấu đã đọc. Tải lại trang/đăng nhập lại để kiểm tra trạng thái đọc còn được giữ; thử tài khoản khác hoặc giảng viên đã bị thu hồi lớp để kiểm tra dữ liệu ngoài phạm vi không xuất hiện.

## Kiểm thử và giới hạn cần giữ rõ

```powershell
npm run check
npm test
npm run test:browser
npm run test:semesters:browser
npm run test:roster:browser
npm run test:workflows:browser
```

Kiểm thử sử dụng SQLite trong bộ nhớ hoặc thư mục tạm, đồng hồ máy chủ điều khiển trong ca thử và phản hồi Google mô phỏng. Không được suy ra từ kết quả này rằng tài khoản thật đã đăng nhập, đã cấp scope hoặc quyền Drive thực tế đã đồng bộ đúng. Kiểm tra Google thật, chính sách tổ chức và tải nhiều người dùng vẫn cần một đợt nghiệm thu riêng.

Các migration được bổ sung để bảo toàn ID, mã nguồn, nội dung chuẩn hóa và liên kết đã có. Không tự phục hồi đè dữ liệu, reset DB, xóa volume hoặc push GitHub trong đợt kiểm thử. Bản chốt cũ tiếp tục bất biến; nhật ký của các chức năng mới được lưu phục vụ đối chiếu.

Phần phát triển tiếp theo nên tập trung vào thời hạn/cấp duyệt phúc tra theo quy trình chính thức, nhắc việc ngoài ứng dụng có đăng ký nhận, kiểm thử Google thật, CI và sao lưu/khôi phục có diễn tập. Không coi các đề xuất này là chức năng đã triển khai chỉ vì đã được mô tả.
