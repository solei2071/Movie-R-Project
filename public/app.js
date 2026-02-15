const state = {
  token: localStorage.getItem('movier_token'),
  user: null,
  movies: [],
  externalMovies: [],
  selectedMovieId: null,
  watchlist: [],
};

const els = {
  userArea: document.getElementById('userArea'),
  logoutBtn: document.getElementById('logoutBtn'),
  loginForm: document.getElementById('loginForm'),
  registerForm: document.getElementById('registerForm'),
  registerFormBack: document.getElementById('toggleAuthBack'),
  registerFormOpen: document.getElementById('toggleAuth'),
  status: document.getElementById('status'),
  searchInput: document.getElementById('searchInput'),
  searchBtn: document.getElementById('searchBtn'),
  refreshBtn: document.getElementById('refreshBtn'),
  searchExternalBtn: document.getElementById('searchExternalBtn'),
  movieList: document.getElementById('movieList'),
  externalSearchResults: document.getElementById('externalSearchResults'),
  movieCounter: document.getElementById('movieCounter'),
  movieDetail: document.getElementById('movieDetail'),
  addMovieToggle: document.getElementById('addMovieToggle'),
  addMoviePanel: document.getElementById('addMoviePanel'),
  addMovieForm: document.getElementById('addMovieForm'),
  watchlistContainer: document.getElementById('watchlistContainer'),
  myReviewList: document.getElementById('myReviewList'),
  loginIdentifier: document.getElementById('identifier'),
  loginPassword: document.getElementById('password'),
  regUsername: document.getElementById('regUsername'),
  regEmail: document.getElementById('regEmail'),
  regPassword: document.getElementById('regPassword'),
};

const setStatus = (message, isError = false) => {
  if (!els.status) {
    return;
  }
  els.status.textContent = message || '';
  els.status.classList.toggle('error', !!isError);
};

const apiRequest = async (url, options = {}) => {
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };
  if (state.token) {
    headers.Authorization = `Bearer ${state.token}`;
  }

  const response = await fetch(url, {
    ...options,
    headers,
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || '요청에 실패했습니다.');
  }
  return data;
};

const toggleAuthMode = (showRegister) => {
  els.registerForm.classList.toggle('hidden', !showRegister);
  els.loginForm.classList.toggle('hidden', showRegister);
};

const setUserState = (user = null, token = null) => {
  state.user = user;
  state.token = token;
  if (token) {
    localStorage.setItem('movier_token', token);
  } else {
    localStorage.removeItem('movier_token');
  }
  renderHeader();
  applyAuthState();
};

const renderHeader = () => {
  if (!els.userArea || !els.logoutBtn) {
    return;
  }
  if (state.user) {
    els.userArea.textContent = `${state.user.username} 님 환영합니다`;
    els.logoutBtn.classList.remove('hidden');
  } else {
    els.userArea.textContent = '로그인 필요';
    els.logoutBtn.classList.add('hidden');
  }
};

const formatDate = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('ko-KR');
};

const loadMe = async () => {
  if (!state.token) {
    return;
  }
  try {
    const res = await apiRequest('/api/auth/me');
    setUserState(res.user, state.token);
  } catch {
    setUserState(null, null);
  }
};

const loadMovies = async () => {
  const search = els.searchInput.value.trim();
  const q = search ? `?search=${encodeURIComponent(search)}` : '';
  const movies = await apiRequest(`/api/movies${q}`);
  state.movies = movies || [];
  renderMovies();
};

const renderExternalSearchResults = () => {
  const items = state.externalMovies || [];
  if (!items.length) {
    els.externalSearchResults.innerHTML = '<p class="muted">TMDB 검색 결과가 없습니다.</p>';
    return;
  }

  els.externalSearchResults.innerHTML = items
    .map(
      (movie) => `
      <article class="movie-card">
        <img class="poster" src="${movie.posterUrl || 'https://placehold.co/160x240?text=Movie'}" alt="${movie.title} 포스터" />
        <div>
          <h3>${movie.title}</h3>
          <p>${movie.year || ''} · ${movie.genre || '-'}</p>
          <p>${(movie.description || '').slice(0, 90)}</p>
          <p class="muted">TMDB ID: ${movie.tmdbId}</p>
          <button class="importFromTmdb" data-tmdb-id="${movie.tmdbId}">내 DB에 추가</button>
        </div>
      </article>
      `
    )
    .join('');
};

const searchExternalMovies = async () => {
  const query = els.searchInput.value.trim();
  if (!query) {
    setStatus('TMDB 검색어를 입력해주세요.', true);
    return;
  }

  try {
    const data = await apiRequest(`/api/external/movies/search?q=${encodeURIComponent(query)}`);
    state.externalMovies = data.movies || [];
    renderExternalSearchResults();
    setStatus(`TMDB 검색: ${data.total || 0}건`);
  } catch (error) {
    setStatus(error.message, true);
  }
};

const importFromTmdb = async (button) => {
  if (!state.user) {
    setStatus('영화를 가져오려면 먼저 로그인해야 합니다.', true);
    return;
  }
  const tmdbId = button?.dataset?.tmdbId;
  if (!tmdbId) {
    return;
  }

  try {
    const imported = await apiRequest('/api/movies/import', {
      method: 'POST',
      body: JSON.stringify({ tmdbId: Number(tmdbId) }),
    });
    setStatus(`"${imported.title}"가 로컬 영화 목록에 추가되었습니다.`);
    await loadMovies();
    await loadWatchlist();
    await loadMyReviews();
  } catch (error) {
    setStatus(error.message, true);
  }
};

const loadWatchlist = async () => {
  if (!state.user) return;
  const rows = await apiRequest('/api/me/watchlist');
  state.watchlist = rows || [];
  renderWatchlist();
};

const loadMyReviews = async () => {
  if (!state.user) return;
  const rows = await apiRequest('/api/me/reviews');
  renderMyReviews(rows || []);
};

const watchlistStatusByMovie = (movieId) => {
  const found = state.watchlist.find((item) => Number(item.movie_id) === Number(movieId));
  return found ? found.status : 'plan_to_watch';
};

const statusLabel = (value) => {
  if (value === 'watching') return '시청 중';
  if (value === 'completed') return '완료';
  return '보고싶음';
};

const renderMovies = () => {
  const { movies } = state;
  els.movieCounter.textContent = `${movies.length}개 영화`;
  if (!movies.length) {
    els.movieList.innerHTML = '<p class="muted">검색 결과가 없습니다.</p>';
    return;
  }

  els.movieList.innerHTML = movies
    .map((m) => {
      const avg = m.avg_rating || 0;
      const selected = Number(state.selectedMovieId) === Number(m.id) ? ' (선택됨)' : '';
      const watchStatus = watchlistStatusByMovie(m.id);
      const controls = state.user
        ? `
            <div>
              <label class="muted">위시리스트</label>
              <select class="watchStatus" data-movie-id="${m.id}">
                <option value="plan_to_watch" ${watchStatus === 'plan_to_watch' ? 'selected' : ''}>보고싶음</option>
                <option value="watching" ${watchStatus === 'watching' ? 'selected' : ''}>시청 중</option>
                <option value="completed" ${watchStatus === 'completed' ? 'selected' : ''}>완료</option>
              </select>
              <button class="saveWatchStatus" data-movie-id="${m.id}" style="margin-top:4px">저장</button>
            </div>`
        : '';

      return `
      <article class="movie-card" data-id="${m.id}">
        <img class="poster" src="${m.poster_url || 'https://placehold.co/160x240?text=Movie'}" alt="${m.title} 포스터" />
        <div>
          <h3>${m.title}${selected}</h3>
          <p>${m.year || ''} / ${m.genre || '-'}</p>
          <p>평점 ${avg.toFixed(1)}점 · ${m.review_count || 0}개의 리뷰</p>
          ${controls}
          <button class="selectMovie" data-movie-id="${m.id}">상세 보기</button>
        </div>
      </article>
      `;
    })
    .join('');
};

const renderMovieDetail = async (movieId) => {
  const id = Number(movieId);
  if (!id) {
    els.movieDetail.innerHTML = '<p class="muted">영화를 선택하면 상세 정보가 보입니다.</p>';
    return;
  }

  const [movie, reviews] = await Promise.all([
    apiRequest(`/api/movies/${id}`),
    apiRequest(`/api/movies/${id}/reviews`),
  ]);

  const mine = (reviews || []).find((r) => state.user && Number(r.user_id) === Number(state.user.id));
  const ratingValue = mine ? mine.rating : 10;
  const reviewTextValue = mine ? mine.review_text || '' : '';
  const watchedOnValue = mine ? mine.watched_on || '' : '';

  const actionBlock = state.user
    ? `<form id="reviewForm" data-movie-id="${id}">
         <label>평점 (1~10)</label>
         <input id="reviewRating" type="range" min="1" max="10" value="${ratingValue}" />
         <p class="muted">현재 점수: <span id="ratingValue">${ratingValue}</span></p>
         <label>관람 날짜</label>
         <input name="watchedOn" type="date" value="${watchedOnValue}" />
         <label>리뷰</label>
         <textarea name="reviewText" rows="4">${reviewTextValue}</textarea>
         <button type="submit">리뷰 저장</button>
       </form>`
    : '<p class="muted">로그인 후 리뷰를 남길 수 있습니다.</p>';

  const reviewsHtml =
    reviews && reviews.length
      ? reviews
          .map(
            (r) => `
          <div class="review-item">
            <strong>${r.username}</strong>
            <div>평점 ${r.rating} · ${formatDate(r.created_at)} ${r.watched_on ? `· ${formatDate(r.watched_on)}` : ''}</div>
            <p>${r.review_text || ''}</p>
          </div>
        `
          )
          .join('')
      : '<p class="muted">아직 리뷰가 없습니다.</p>';

  els.movieDetail.innerHTML = `
    <h2>${movie.title} (${movie.year || '-'})</h2>
    <p>${movie.genre || '-'}</p>
    <p>${movie.description || ''}</p>
    <p>평균 ${movie.avg_rating.toFixed(1)}점 · ${movie.review_count}개의 리뷰</p>
    ${actionBlock}
    <hr />
    <h3>리뷰</h3>
    ${reviewsHtml}
  `;

  const form = document.getElementById('reviewForm');
  const range = document.getElementById('ratingValue');
  if (form) {
    const ratingInput = form.querySelector('#reviewRating');
    ratingInput.addEventListener('input', (event) => {
      if (range) {
        range.textContent = event.target.value;
      }
    });
  }
};

const renderWatchlist = () => {
  if (!state.watchlist.length) {
    els.watchlistContainer.innerHTML = '<p class="muted">위시리스트가 비어 있습니다.</p>';
    return;
  }
  els.watchlistContainer.innerHTML = state.watchlist
    .map(
      (item) => `<div class="watch-item">
      <strong>${item.title} (${item.year || '-'})</strong>
      <p>${statusLabel(item.status)} · ${formatDate(item.added_at)}</p>
      <button class="removeWatch item-action" data-movie-id="${item.movie_id}" style="margin-top:4px">제거</button>
    </div>`
    )
    .join('');
};

const renderMyReviews = (items) => {
  if (!items.length) {
    els.myReviewList.innerHTML = '<p class="muted">내 리뷰가 없습니다.</p>';
    return;
  }
  els.myReviewList.innerHTML = items
    .map(
      (item) => `<div class="review-item">
      <strong>${item.title}</strong> · ${item.rating}점
      <p>${item.review_text || ''}</p>
      <p class="muted">${formatDate(item.created_at)}</p>
      <button class="deleteReview item-action" data-review-id="${item.id}" style="margin-top:4px">삭제</button>
    </div>`
    )
    .join('');
};

const selectMovie = async (movieId) => {
  state.selectedMovieId = movieId;
  await renderMovieDetail(movieId);
  renderMovies();
};

const submitLogin = async (event) => {
  event.preventDefault();
  const payload = {
    identifier: els.loginIdentifier.value.trim(),
    password: els.loginPassword.value.trim(),
  };
  if (!payload.identifier || !payload.password) {
    setStatus('아이디/이메일과 비밀번호를 입력하세요.', true);
    return;
  }
  try {
    const result = await apiRequest('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    setUserState(result.user, result.token);
    els.loginIdentifier.value = '';
    els.loginPassword.value = '';
    setStatus('로그인 되었습니다.');
    await Promise.all([loadMovies(), loadWatchlist(), loadMyReviews()]);
  } catch (error) {
    setStatus(error.message, true);
  }
};

const submitRegister = async (event) => {
  event.preventDefault();
  const username = els.regUsername.value.trim();
  const email = els.regEmail.value.trim();
  const password = els.regPassword.value.trim();

  if (!username || !email || !password) {
    setStatus('회원가입 정보를 모두 입력하세요.', true);
    return;
  }

  try {
    const result = await apiRequest('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, email, password }),
    });
    setUserState(result.user, result.token);
    els.regUsername.value = '';
    els.regEmail.value = '';
    els.regPassword.value = '';
    setStatus('회원가입이 완료되었습니다.');
    await Promise.all([loadMovies(), loadWatchlist(), loadMyReviews()]);
  } catch (error) {
    setStatus(error.message, true);
  }
};

const submitAddMovie = async (event) => {
  event.preventDefault();
  if (!state.user) {
    setStatus('로그인이 필요합니다.', true);
    return;
  }

  const title = document.getElementById('movieTitle').value.trim();
  const year = document.getElementById('movieYear').value.trim();
  const genre = document.getElementById('movieGenre').value.trim();
  const posterUrl = document.getElementById('moviePoster').value.trim();
  const description = document.getElementById('movieDesc').value.trim();

  if (!title) {
    setStatus('영화 제목을 입력해 주세요.', true);
    return;
  }

  try {
    await apiRequest('/api/movies', {
      method: 'POST',
      body: JSON.stringify({ title, year, genre, description, posterUrl }),
    });
    document.getElementById('movieTitle').value = '';
    document.getElementById('movieYear').value = '';
    document.getElementById('movieGenre').value = '';
    document.getElementById('moviePoster').value = '';
    document.getElementById('movieDesc').value = '';
    setStatus('영화가 추가되었습니다.');
    await loadMovies();
  } catch (error) {
    setStatus(error.message, true);
  }
};

const submitReview = async (event) => {
  const form = event.target.closest('#reviewForm');
  if (!form) return;
  event.preventDefault();

  const movieId = Number(form.dataset.movieId);
  const rating = Number(form.querySelector('#reviewRating')?.value || 0);
  const watchedOn = form.querySelector('input[name="watchedOn"]').value;
  const reviewText = form.querySelector('textarea[name="reviewText"]').value.trim();

  try {
    await apiRequest(`/api/movies/${movieId}/reviews`, {
      method: 'POST',
      body: JSON.stringify({ rating, watchedOn, reviewText }),
    });
    setStatus('리뷰가 저장되었습니다.');
    await selectMovie(movieId);
    await loadMovies();
    await loadMyReviews();
  } catch (error) {
    setStatus(error.message, true);
  }
};

const saveWatchStatus = async (button) => {
  if (!state.user) return;
  const movieId = Number(button.dataset.movieId);
  const select = document.querySelector(`select.watchStatus[data-movie-id="${movieId}"]`);
  const status = select?.value;
  try {
    await apiRequest(`/api/movies/${movieId}/watchlist`, {
      method: 'POST',
      body: JSON.stringify({ status }),
    });
    setStatus('위시리스트 상태가 저장되었습니다.');
    await Promise.all([loadWatchlist(), loadMovies()]);
  } catch (error) {
    setStatus(error.message, true);
  }
};

const deleteReview = async (button) => {
  const reviewId = Number(button.dataset.reviewId);
  try {
    await apiRequest(`/api/reviews/${reviewId}`, { method: 'DELETE' });
    setStatus('리뷰가 삭제되었습니다.');
    await Promise.all([loadMyReviews(), loadMovies()]);
    if (state.selectedMovieId) {
      await selectMovie(state.selectedMovieId);
    }
  } catch (error) {
    setStatus(error.message, true);
  }
};

const removeWatch = async (button) => {
  const movieId = Number(button.dataset.movieId);
  try {
    await apiRequest(`/api/me/watchlist/${movieId}`, { method: 'DELETE' });
    setStatus('위시리스트에서 제거했습니다.');
    await Promise.all([loadWatchlist(), loadMovies()]);
  } catch (error) {
    setErrorMessage(error.message);
  }
};

const setErrorMessage = (message) => setStatus(message, true);

const bindEvents = () => {
  els.loginForm.addEventListener('submit', submitLogin);
  els.registerForm.addEventListener('submit', submitRegister);
  els.registerFormOpen.addEventListener('click', () => toggleAuthMode(true));
  els.registerFormBack.addEventListener('click', () => toggleAuthMode(false));
  els.logoutBtn.addEventListener('click', () => {
    setUserState(null, null);
    state.selectedMovieId = null;
    renderMovies();
    renderWatchlist();
    renderMyReviews([]);
    els.movieDetail.innerHTML = '<p class="muted">영화를 선택하면 상세 정보가 보입니다.</p>';
    setStatus('로그아웃 되었습니다.');
  });

  els.searchBtn.addEventListener('click', loadMovies);
  els.searchExternalBtn.addEventListener('click', searchExternalMovies);
  els.refreshBtn.addEventListener('click', () => {
    els.searchInput.value = '';
    loadMovies();
  });
  els.addMovieToggle.addEventListener('click', () => {
    els.addMoviePanel.classList.toggle('hidden');
  });
  els.addMovieForm.addEventListener('submit', submitAddMovie);

  els.movieList.addEventListener('click', async (event) => {
    const selectBtn = event.target.closest('.selectMovie');
    if (selectBtn) {
      const id = Number(selectBtn.dataset.movieId);
      await selectMovie(id);
      return;
    }
    const saveBtn = event.target.closest('.saveWatchStatus');
    if (saveBtn) {
      await saveWatchStatus(saveBtn);
    }
  });
  els.externalSearchResults.addEventListener('click', async (event) => {
    const importBtn = event.target.closest('.importFromTmdb');
    if (importBtn) {
      await importFromTmdb(importBtn);
    }
  });

  els.movieDetail.addEventListener('submit', submitReview);
  els.watchlistContainer.addEventListener('click', (event) => {
    const removeBtn = event.target.closest('.removeWatch');
    if (removeBtn) {
      removeWatch(removeBtn);
    }
  });
  els.myReviewList.addEventListener('click', (event) => {
    const deleteBtn = event.target.closest('.deleteReview');
    if (deleteBtn) {
      deleteReview(deleteBtn);
    }
  });

  els.searchInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      loadMovies();
    }
  });
};

const applyAuthState = () => {
  const authVisible = !state.user;
  const addMovieToggle = document.getElementById('addMovieToggle');
  const addMoviePanel = document.getElementById('addMoviePanel');

  els.loginForm.classList.toggle('hidden', !authVisible);
  els.registerForm.classList.add('hidden');
  toggleAuthMode(false);
  addMovieToggle.classList.toggle('hidden', !state.user);
  if (!state.user) {
    addMoviePanel.classList.add('hidden');
  }
  if (state.user) {
    document.getElementById('authArea').classList.add('hidden');
    els.logoutBtn.classList.remove('hidden');
  } else {
    document.getElementById('authArea').classList.remove('hidden');
    els.logoutBtn.classList.add('hidden');
  }
  document.getElementById('addMoviePanel').classList.add('hidden');
};

const init = async () => {
  bindEvents();
  await loadMe();
  renderHeader();
  applyAuthState();
  await loadMovies();

  if (state.user) {
    await Promise.all([loadWatchlist(), loadMyReviews()]);
  } else {
    renderWatchlist();
    renderMyReviews([]);
  }
};

init().catch((error) => setStatus(error.message, true));
