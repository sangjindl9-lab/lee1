// Railway용 정적 서버: dist/ 를 그대로 서빙
import express from 'express'
import path from 'path'
import { fileURLToPath } from 'url'
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()
app.use(express.static(path.join(__dirname, 'dist'), { maxAge: '1d' }))
app.get('*', (_, res) => res.sendFile(path.join(__dirname, 'dist', 'index.html')))
app.listen(process.env.PORT || 3000, () => console.log('esign-maker up'))
