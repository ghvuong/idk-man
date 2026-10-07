# Phác sơ đồ tikz-cd

Vẽ tay sơ đồ giao hoán (commutative diagram) bằng chuột, bút cảm ứng hoặc ngón tay, và nhận ngay mã
LaTeX: **tikz-cd**, **CD** (chạy trong KaTeX/MathJax) và **xymatrix**, kèm ảnh SVG/PNG và liên kết mở
trong [quiver](https://q.uiver.app).

Ví dụ: vẽ ba nét giữa bốn đối tượng là có ngay sơ đồ của Bài 1.3.B (Vakil, *The Rising Sea*):

```latex
\begin{tikzcd}
  X_1 \arrow[dr] \\
  & Y \arrow[r] & Z \\
  X_2 \arrow[ur]
\end{tikzcd}
```

Ứng dụng là một trang web tĩnh, không cần cài đặt hay build: mở `index.html` qua một máy chủ tĩnh bất kỳ.

## Cách vẽ

| Thao tác | Kết quả |
| --- | --- |
| Chạm vào ô trống | Thêm đối tượng, gõ nhãn LaTeX (`X_1`, `A[x]/(x^3)`, …) |
| Kéo một nét từ đối tượng A sang B | Mũi tên A → B. Nét cong → `bend left/right` |
| Kéo nét ra chỗ trống | Tự tạo đối tượng mới ở ô đó |
| Vẽ nhiều gạch ngắn nối tiếp | Mũi tên nét đứt (`dashed`) |
| Bắt đầu nét bằng một móc nhỏ | `hook` (↪) |
| Gạch ngang ở đuôi / dấu > ở đuôi / dấu > thứ hai ở đầu | `maps to` (↦) / `tail` (↣) / `two heads` (↠) |
| Đi ra rồi quay về chính đối tượng | Vòng lặp (`loop`) |
| Vẽ dấu ⌟ trong hình vuông, sát một đỉnh | Dấu pullback (`phantom, "\lrcorner"`) |
| Gạch zíc-zắc lên thứ gì đó | Xóa |
| Khoanh vùng | Chọn nhiều đối tượng; giữ lâu rồi kéo để di chuyển |
| Viết tay nhãn vào ô trống hoặc cạnh mũi tên | Claude đọc chữ thành LaTeX (khi mở trên claude.ai); nơi khác thì mở ô nhập |

Công cụ **Chọn**: kéo đối tượng để di chuyển, kéo mũi tên sang ngang để uốn cong, kéo nền để chọn vùng.
Công cụ **Phác tự do** (chỉ có trên claude.ai): vẽ cả sơ đồ, kể cả chữ, rồi bấm *Nhận dạng*. Nút
*Từ ảnh chụp* nhận dạng một sơ đồ vẽ trên giấy.

Bàn phím: `Enter` sửa nhãn · gõ phím bất kỳ khi đang chọn để đặt nhãn · `Delete` xóa ·
`Ctrl+Z` / `Ctrl+Shift+Z` · phím mũi tên di chuyển · giữ `Space` rồi kéo để cuộn · `Ctrl`+cuộn hoặc hai
ngón để thu phóng.

Bảng bên phải cho phép chỉnh kiểu mũi tên (đầu, đuôi, thân, nét đôi ⇒, độ cong, dịch song song, vị trí nhãn)
và xuất mã. Mũi tên song song giữa cùng hai đối tượng tự được tách bằng `shift left/right`. Nút
*Dán mã tikz-cd* đọc lại mã tikz-cd có sẵn (kể cả mã xuất từ quiver) để sửa tiếp bằng tay.

## Chạy trên máy

```sh
python3 -m http.server 8000   # rồi mở http://localhost:8000
```

Nhãn được dựng bằng MathJax (tải từ cdnjs); khi không có mạng, nhãn hiện ở dạng Unicode gần đúng.
Để đưa lên mạng, bật GitHub Pages cho nhánh chính (thư mục gốc) hoặc chép thư mục này lên bất kỳ máy chủ tĩnh nào.

## Kiểm thử

```sh
npm test                              # bộ xuất tikz-cd/CD/xymatrix/quiver và bộ đọc tikz-cd
node tests/latex-check.mjs 400        # biên dịch thật bằng pdflatex (cần TeX Live có tikz-cd, xypic)
```

`latex-check` sinh hàng trăm sơ đồ ngẫu nhiên và biên dịch mã xuất ra. Vòng lặp của xy-pic đôi khi
lỗi với vài nhãn (lỗi của chính xy-pic), nên phần xymatrix bỏ qua vòng lặp; tikz-cd thì kiểm tra tất cả.

## Cấu trúc

| Tệp | Vai trò |
| --- | --- |
| `js/model.js` | Mô hình sơ đồ (đối tượng trên lưới, mũi tên), lịch sử hoàn tác |
| `js/gestures.js` | Phân tích hình dạng nét: zíc-zắc, vòng kín, móc, độ cong, dấu nhỏ |
| `js/pen.js` | Con trỏ/bút/cảm ứng → thao tác trên sơ đồ |
| `js/render.js` | Vẽ SVG: lưới soạn thảo và bố cục kiểu tikz-cd cho xuất ảnh |
| `js/tikz.js` | Xuất và đọc tikz-cd |
| `js/formats.js` | Xuất CD (amscd), xymatrix, liên kết quiver |
| `js/ai.js` | Nhận dạng chữ viết tay và ảnh bằng Claude (khả năng `sample` của artifact claude.ai) |
| `tools/build-artifact.mjs` | Đóng gói để đăng thành artifact trên claude.ai |

## Vì sao tự viết

Các công cụ hiện có đều là trình soạn thảo bấm-chuột, không nhận nét vẽ tay:

- [quiver](https://q.uiver.app) ([mã nguồn](https://github.com/varkor/quiver)): trình soạn sơ đồ giao hoán
  tốt nhất hiện nay, xuất tikz-cd và Typst; thao tác bằng chuột và bàn phím trên lưới. App này xuất được
  liên kết mở thẳng trong quiver.
- [tikzcd-editor](https://github.com/yishn/tikzcd-editor): trình soạn trực quan đơn giản, ngừng cập nhật từ 2020.
- [Mathcha](https://www.mathcha.io/documentation/export-import/): trình soạn toán WYSIWYG, xuất TikZ chung.
- Plugin Obsidian *cdrawer*: soạn trên lưới, xuất tikz-cd hoặc CD.
- [DeTikZify](https://arxiv.org/abs/2405.15306) (NeurIPS 2024): mô hình chuyển phác thảo thành TikZ;
  là nghiên cứu, cần GPU, không dành riêng cho tikz-cd.
- [Mathpix](https://mathpix.com/blog/drawing-on-mobile-tablet): nhận chữ viết tay thành LaTeX cho công thức,
  không cho sơ đồ.

---

## English

**Phác sơ đồ** ("sketch a diagram") turns hand-drawn strokes into commutative diagrams and emits
tikz-cd, amscd `CD` (renders in KaTeX/MathJax) and xymatrix code, standalone SVG/PNG, and a quiver link.
Tap to add objects, draw strokes between them for arrows; curved strokes bend, dashes make dashed arrows,
a hook at the start gives ↪, a bar/chevron at the tail gives ↦/↣, a second chevron at the head gives ↠,
a ⌟ inside a square adds the pullback corner, and scribbling deletes. When the page runs as a claude.ai
artifact, handwritten labels, whole free-hand sketches and photos of paper diagrams are read by Claude.
It is a static site with no build step; run `npm test` for the exporter tests and
`node tests/latex-check.mjs` to compile random diagrams with pdflatex.
