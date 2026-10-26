# 검측서류 작성·관리 — 웹 서버 (Railway)
FROM golang:1.24-alpine AS build
WORKDIR /src
COPY go.mod ./
COPY *.go index.html ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags "-s -w" -o /gcms .

FROM alpine:3.20
RUN apk add --no-cache ca-certificates tzdata
ENV GCMS_WEB=1 GCMS_DATA_DIR=/data TZ=Asia/Seoul
COPY --from=build /gcms /gcms
EXPOSE 8080
CMD ["/gcms"]
