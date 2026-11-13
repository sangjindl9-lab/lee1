# 화면 자동 점검

```
npm i -D playwright@1.52.0      # 저장소에는 넣지 않음(브라우저를 내려받음)
node test/run.mjs               # /tmp/samples 의 sample.pdf, example_2000.dwg, *.dxf 를 연다
```
결과 화면은 `test/out/*.png`, 저장된 PDF 는 `test/out/saved.pdf`.
