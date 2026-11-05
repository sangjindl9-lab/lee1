// 다국어 구조: 한국어 기본, 영어·일본어·중국어는 사전을 추가하면 된다(없는 키는 한국어로 표시).
const ko = {
  'app.name': 'EUM 3D STUDIO PRO',
  'nav.project': '프로젝트', 'nav.upload': '파일 업로드', 'nav.convert': '3D 변환', 'nav.edit': '모델 편집',
  'nav.explode': '분해도', 'nav.simulate': '시뮬레이션', 'nav.video': '동영상 제작', 'nav.share': '공유', 'nav.export': '내보내기',
  'industry.mold': '금형', 'industry.machine': '기계·산업장비', 'industry.electric': '전기·정보통신', 'industry.building': '건축·건설', 'industry.product': '일반 제품',
};
const en: Partial<typeof ko> = {
  'nav.project': 'Project', 'nav.upload': 'Upload', 'nav.convert': '3D Convert', 'nav.edit': 'Edit', 'nav.explode': 'Explode',
  'nav.simulate': 'Simulate', 'nav.video': 'Video', 'nav.share': 'Share', 'nav.export': 'Export',
};
const dicts: Record<string, Partial<typeof ko>> = { ko, en, ja: {}, zh: {} };
let lang = (() => { try { return localStorage.getItem('eum3d.lang') || 'ko'; } catch { return 'ko'; } })();
export const setLang = (l: string) => { lang = l; try { localStorage.setItem('eum3d.lang', l); } catch { /* 무시 */ } location.reload(); };
export const getLang = () => lang;
export const t = (k: keyof typeof ko) => dicts[lang]?.[k] ?? ko[k] ?? k;
