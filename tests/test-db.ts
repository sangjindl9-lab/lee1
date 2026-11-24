/**
 * 테스트 DB 주소. 운영 DB 를 실수로 건드리지 않도록 로컬(localhost·127.0.0.1) PostgreSQL 만 허용한다.
 */
export function testDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL 이 없습니다. 로컬 임시 PostgreSQL 주소를 지정하세요. (예: postgresql://postgres:postgres@localhost:5432/fa_test)");
  const host = new URL(url).hostname;
  if (!["localhost", "127.0.0.1", "::1", "postgres"].includes(host)) {
    throw new Error(`테스트는 로컬 임시 DB 에서만 실행합니다. (받은 호스트: ${host})`);
  }
  return url;
}
