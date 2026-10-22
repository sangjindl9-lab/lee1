/** node:test 위에서 jest 와 같은 이름으로 쓰기 위한 얇은 연결 */
import './env';
import { after, before, describe, it } from 'node:test';
export { expect } from 'expect';
export { describe, it };
export const beforeAll = before;
export const afterAll = after;
