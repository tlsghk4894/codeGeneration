const express = require('express');
const app = express();

// .listen(서버띄울 포트번호, 띄운 후 실행할 코드)
app.listen(8080, function() {
    console.log('listening on 8080')
}); 