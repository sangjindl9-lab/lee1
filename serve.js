// Railway용 정적 서버: dist/ 를 그대로 서빙
import express from 'express'
import path from 'path'
import { fileURLToPath } from 'url'
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dist = path.join(__dirname, 'dist')
const app = express()
// assets/ 는 파일명에 해시가 붙어 있어 오래 캐시해도 됨. index.html 은 매번 새로 받게 해서
// 배포 후에도 휴대폰이 옛 화면(없는 JS 파일)을 붙잡지 않도록 함
app.use('/assets', express.static(path.join(dist, 'assets'), { maxAge: '1y', immutable: true, fallthrough: false }))
app.use(express.static(dist, { maxAge: 0, setHeaders: (res, p) => { if (p.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache') } }))
app.get('*', (_, res) => { res.setHeader('Cache-Control', 'no-cache'); res.sendFile(path.join(dist, 'index.html')) })
app.listen(process.env.PORT || 3000, () => console.log('esign-maker up'))
