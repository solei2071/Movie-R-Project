# Movie R (Letterboxd 스타일 MVP)

Letterboxd 느낌의 영화 기록/리뷰 서비스 최소 버전(MVP)입니다.

- Express + SQLite 백엔드
- 회원가입/로그인(JWT)
- 영화 목록 조회/검색
- 영화 상세 조회
- 평점+리뷰 작성/수정(한 사용자-한 영화 1개)
- 위시리스트(볼 예정/시청 중/완료)
- 내 리뷰/위시리스트 패널
- TMDB 연동: 검색한 영화를 외부에서 가져와 내 데이터베이스에 등록

## 실행 방법

```bash
npm install
npm start
```

브라우저에서 `http://localhost:3000` 접속

## 기본 파일

- `server.js` : API + DB 초기화
- `public/index.html` : UI
- `public/styles.css` : 기본 스타일
- `public/app.js` : 프런트 동작
- `data/movier.db` : 앱 실행 시 자동 생성되는 SQLite DB

## TMDB API 키 설정 (영화 정보 자동 가져오기)

TMDB에서 영화를 불러오려면 API 키가 필요합니다.

```bash
export TMDB_API_KEY=your_api_key_here
npm start
```

macOS에서는 `.zshrc`에 `export TMDB_API_KEY=...`를 넣거나 실행 직전에 설정할 수 있습니다.

## API 요약

- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/auth/me`
- `GET /api/movies?search=`
- `POST /api/movies`
- `GET /api/external/movies/search?q=`
- `POST /api/movies/import`
- `GET /api/movies/:id`
- `GET /api/movies/:id/reviews`
- `POST /api/movies/:id/reviews`
- `DELETE /api/reviews/:id`
- `POST /api/movies/:id/watchlist`
- `GET /api/me/watchlist`
- `DELETE /api/me/watchlist/:movieId`
- `GET /api/me/reviews`

## 참고

- 이 MVP는 운영 배포 전 인증/보안/검증 로직(입력 정규화, 레이트 리밋, HTTPS, 비밀번호 정책 강화)이 추가로 필요합니다.
