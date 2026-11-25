// 홍보 방법 체크리스트 — 혼자서도 돈 들이지 않고 할 수 있는 것부터
module.exports = [
  {
    group: '스토어 안에서', note: '검색으로 들어오는 사람이 가장 많습니다. 글을 쓰기 전에 여기부터 손봅니다.',
    items: [
      { key: 'aso_title', title: '앱 이름과 간단한 설명에 검색어 넣기', desc: '사람들이 실제로 검색하는 낱말을 이름 30자, 간단한 설명 80자 안에 넣습니다.', kind: 'store_listing' },
      { key: 'aso_shots', title: '스크린샷 첫 두 장에 핵심 기능 문구 넣기', desc: '검색 결과에는 첫 두세 장만 보입니다. 화면 위에 한 줄 설명을 얹습니다.' },
      { key: 'aso_locale', title: '스토어 등록정보를 출시 국가 언어로 번역', desc: '플레이 콘솔의 번역 추가에서 언어별 이름·설명을 따로 넣습니다.', kind: 'store_listing' },
      { key: 'review_reply', title: '리뷰 전부에 답글 달기', desc: '답글은 다음 방문자가 읽습니다. 낮은 별점일수록 먼저 답합니다.', kind: 'review_reply' },
      { key: 'inapp_review', title: '앱 안에서 리뷰 요청 띄우기', desc: '사용자가 작업을 끝낸 직후에 구글 인앱 리뷰 창을 띄웁니다.' },
      { key: 'cross_promo', title: '내 다른 앱에서 서로 소개하기', desc: '앱 화면의 "다른 앱" 메뉴에 이 프로그램의 앱 목록 주소를 연결합니다. 앱 화면에서 주소를 복사할 수 있습니다.' },
    ],
  },
  {
    group: '내 채널', note: '한 번 써 두면 검색으로 계속 들어옵니다. 자동 발행과 예약을 걸어 둡니다.',
    items: [
      { key: 'own_naver', title: '네이버 블로그에 주 2회 글 올리기', desc: '자동 규칙으로 올릴 글을 미리 만들어 두고, 복사해서 붙여 넣습니다.', kind: 'blog_feature' },
      { key: 'own_blogger', title: '구글 블로거·워드프레스 자동 발행 켜기', desc: '해외 사용자용으로 영어 글을 자동 발행합니다. 구글 검색에 잡힙니다.', kind: 'blog_howto' },
      { key: 'own_landing', title: '앱 소개 페이지를 검색엔진에 등록', desc: '구글 서치 콘솔과 네이버 서치어드바이저에 이 프로그램의 사이트맵 주소를 제출합니다.' },
      { key: 'own_shorts', title: '화면 녹화로 쇼츠 영상 올리기', desc: '30초짜리 사용 장면 영상을 유튜브 쇼츠·인스타 릴스·틱톡에 같이 올립니다.', kind: 'shorts_script' },
      { key: 'own_sns', title: '블루스카이·마스토돈·텔레그램 자동 발행 켜기', desc: '짧은 글은 연결만 해 두면 손댈 일이 없습니다.', kind: 'sns_short' },
      { key: 'own_insta', title: '인스타그램·스레드에 소개 글 올리기', desc: '스크린샷 3~5장과 캡션을 올립니다.', kind: 'sns_caption' },
    ],
  },
  {
    group: '국내 커뮤니티', note: '곳마다 홍보 규정이 다릅니다. 올리기 전에 공지를 꼭 확인하세요. 규정을 어기면 글이 지워지고 계정이 막힙니다.',
    items: [
      { key: 'kr_disquiet', title: '디스콰이엇에 제품 등록', desc: '만든 사람이 직접 제품을 올리고 의견을 받는 곳입니다.', url: 'https://disquiet.io', kind: 'community' },
      { key: 'kr_geeknews', title: '긱뉴스 Show GN에 올리기', desc: '직접 만든 것을 소개하는 게시판입니다. 개발 과정 이야기가 반응이 좋습니다.', url: 'https://news.hada.io', kind: 'blog_devlog' },
      { key: 'kr_cafe', title: '분야가 맞는 네이버 카페 홍보 게시판', desc: '앱 분야와 맞는 카페에서 홍보가 허용된 게시판에만 올립니다.', kind: 'community' },
      { key: 'kr_niche', title: '대상 사용자가 모이는 커뮤니티 찾기', desc: '예: 전기 기사용 앱이면 전기 기술자 카페·밴드. 한 곳에 꾸준히 답글을 다는 쪽이 여러 곳에 뿌리는 것보다 낫습니다.', kind: 'community' },
    ],
  },
  {
    group: '해외', note: '영어 글이 필요합니다. 글 만들기에서 언어를 영어로 고르세요.',
    items: [
      { key: 'gl_producthunt', title: 'Product Hunt에 출시 등록', desc: '출시 당일 하루 동안 노출됩니다. 스크린샷과 한 줄 소개를 미리 준비합니다.', url: 'https://www.producthunt.com', kind: 'blog_intro' },
      { key: 'gl_reddit', title: 'Reddit 관련 게시판에 소개', desc: '게시판마다 자기 홍보 규칙이 있습니다. 규칙에서 허용하는 요일·형식에 맞춰 올립니다.', url: 'https://www.reddit.com', kind: 'community' },
      { key: 'gl_hn', title: 'Hacker News에 Show HN으로 올리기', desc: '직접 써 볼 수 있는 것만 올릴 수 있습니다. 기술 이야기를 곁들입니다.', url: 'https://news.ycombinator.com/show', kind: 'blog_devlog' },
      { key: 'gl_alternativeto', title: 'AlternativeTo에 앱 등록', desc: '비슷한 앱을 찾는 사람에게 대안으로 노출됩니다.', url: 'https://alternativeto.net' },
      { key: 'gl_indiehackers', title: 'Indie Hackers에 개발 기록 쓰기', desc: '1인 개발자들이 모이는 곳입니다. 숫자와 과정을 솔직하게 씁니다.', url: 'https://www.indiehackers.com', kind: 'blog_devlog' },
    ],
  },
  {
    group: '그 밖에', note: '',
    items: [
      { key: 'etc_people', title: '거래처·지인에게 알리기', desc: '업무용 앱이면 실제로 쓸 사람에게 직접 보내는 것이 가장 확실합니다.', kind: 'sns_short' },
      { key: 'etc_press', title: '분야 매체·뉴스레터에 보도자료 보내기', desc: '분야 전문 매체나 뉴스레터 운영자에게 짧은 소개 메일을 보냅니다.', kind: 'press' },
      { key: 'etc_update', title: '업데이트할 때마다 소식 글 올리기', desc: '업데이트는 다시 글을 쓸 좋은 이유입니다.', kind: 'blog_update' },
      { key: 'etc_ads', title: '구글 앱 캠페인 소액 시험', desc: '하루 몇 천 원으로 설치당 비용을 먼저 재 봅니다. 유료라서 맨 마지막에 둡니다.' },
    ],
  },
];
