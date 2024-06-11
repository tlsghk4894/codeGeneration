const express = require('express');
const app = express();
const port = 8080;

// 임시 데이터 대체 (실제 데이터베이스 연결 및 데이터를 가져오는 작업은 필요에 따라 구현해야 함)
const itemList = require('./sampleData/itemList.json');

app.get('/itemDetail', (req, res) => {
    // request 객체에서 item_id를 가져옴 (실제로는 HTTP 요청에 따라 item_id를 추출해야 함)
    const item_id = parseInt(req.query.item_id);

    // item_id를 이용하여 itemList에서 해당 아이템 정보를 찾음 (실제로는 데이터베이스에서 조회해야 함)
    const item = itemList.find(item => item.item_id === item_id);

    // 아이템이 존재하지 않는 경우 404 에러 반환
    if (!item) {
        res.status(404).send('Item not found');
        return;
    }

    // HTML 템플릿 생성
    const htmlTemplate = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
            <link rel="stylesheet" type="text/css" href="../css/main.css">
            <script type="text/javascript">
                function goBack() {
                    window.history.back();
                }

                function confirmDelete() {
                    // 삭제 기능의 자바스크립트 코드
                    // 이 부분은 필요에 따라 수정하여 사용해야 함
                }
            </script>
            <title>Device Item Metadata Detail</title>
        </head>
        <body>
            <header>
                <!-- partItemHeader.jsp 내용 -->
            </header>
            <main>
                <div class="SubTitleBar">
                    <h1>Item Detail</h1>
                </div>
                <h2>[${item.item_id}] ${item.model_name}</h2>
                <div class="NarrowTable">
                    <!-- 아이템 정보 테이블 -->
                    <!-- 여기에 ${item} 정보를 사용하여 HTML 테이블을 생성 -->
                </div>
            </main>
        </body>
        </html>
    `;

    // 생성된 HTML 전송
    res.send(htmlTemplate);
});

app.listen(port, () => {
    console.log(`Server is listening at http://localhost:${port}`);
});
