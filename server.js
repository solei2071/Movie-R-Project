const express = require('express');
const path = require('path');
const fs = require('fs');
const Database = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-production';
const DB_PATH = path.join(__dirname, 'data', 'movier.db');
const TMDB_API_KEY = process.env.TMDB_API_KEY || '';
const TMDB_URL = 'https://api.themoviedb.org/3';
const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p/w500';

if (!fs.existsSync(path.dirname(DB_PATH))) {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
}

const db = new Database.Database(DB_PATH);

const run = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) {
        return reject(err);
      }
      resolve(this);
    });
  });

const get = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) {
        return reject(err);
      }
      resolve(row);
    });
  });

const all = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) {
        return reject(err);
      }
      resolve(rows || []);
    });
  });

const toNumber = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const tmdbRequest = async (path, params = {}) => {
  if (!TMDB_API_KEY) {
    const error = new Error('TMDB API 키가 설정되지 않았습니다.');
    error.statusCode = 500;
    throw error;
  }

  const query = new URLSearchParams({
    api_key: TMDB_API_KEY,
    language: 'ko-KR',
    ...Object.entries(params).reduce((acc, [key, value]) => {
      if (value === undefined || value === null || value === '') {
        return acc;
      }
      acc[key] = String(value);
      return acc;
    }, {}),
  });
  const url = `${TMDB_URL}/${path}?${query.toString()}`;
  const response = await fetch(url);

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = body.status_message || `TMDB API 호출 실패 (${response.status})`;
    const error = new Error(message);
    error.statusCode = response.status;
    throw error;
  }

  return body;
};

const normalizeTmdbMovie = (movie) => ({
  tmdbId: String(movie.id),
  title: movie.title || movie.name || '',
  year: movie.release_date ? Number(movie.release_date.slice(0, 4)) : null,
  description: movie.overview || '',
  posterUrl: movie.poster_path ? `${TMDB_IMAGE_BASE}${movie.poster_path}` : null,
  genre: '',
});

const mapTmdbDetailToMovieInsert = (detail) => {
  const year = detail.release_date ? Number(detail.release_date.slice(0, 4)) : null;
  const genre = Array.isArray(detail.genres) ? detail.genres.map((item) => item.name).join(', ') : '';
  return {
    title: detail.title || detail.name || '',
    year,
    genre,
    description: detail.overview || '',
    posterUrl: detail.poster_path ? `${TMDB_IMAGE_BASE}${detail.poster_path}` : null,
    externalSource: 'tmdb',
    externalId: String(detail.id),
  };
};

const ensureMovieColumns = async () => {
  const columns = await all(`PRAGMA table_info(movies)`);
  const columnNames = new Set(columns.map((col) => col.name));

  if (!columnNames.has('external_source')) {
    await run('ALTER TABLE movies ADD COLUMN external_source TEXT');
  }
  if (!columnNames.has('external_id')) {
    await run('ALTER TABLE movies ADD COLUMN external_id TEXT');
  }

  await run(`
    CREATE INDEX IF NOT EXISTS idx_movies_external_id
    ON movies (external_source, external_id)
  `);
};

const normalizeMovie = (movie) => {
  if (!movie) {
    return movie;
  }
  return {
    ...movie,
    year: movie.year ? Number(movie.year) : null,
    avg_rating: movie.avg_rating ? Number(movie.avg_rating) : 0,
    review_count: movie.review_count ? Number(movie.review_count) : 0,
  };
};

const seedMovies = async () => {
  const countRow = await get('SELECT COUNT(*) as count FROM movies');
  if (countRow && countRow.count > 0) {
    return;
  }

  const seedData = [
    ['기생충', 2019, '드라마, 스릴러', '가난한 가족과 부유한 가정의 충돌을 통해 사회적 계급 차이를 다룬 영화.', 'https://placehold.co/320x480?text=%EA%B8%B0%EC%83%9D%EC%B6%A9'],
    ['인터스텔라', 2014, 'SF, 드라마', '시간의 상대성과 인간의 생존 본능을 담은 우주 대서사.', 'https://placehold.co/320x480?text=%EC%9D%B8%ED%84%B0%EC%8A%A4%ED%85%94%EB%9D%BC'],
    ['라라랜드', 2016, '뮤지컬, 로맨스', '꿈과 사랑 사이에서 갈등하는 두 예술가의 사랑 이야기.', 'https://placehold.co/320x480?text=%EB%9D%BC%EB%9D%BC%EB%9E%9C%EB%93%9C'],
    ['센과 치히로의 행방불명', 2001, '판타지, 애니메이션', '정체성과 성장을 다룬 고전 애니메이션.', 'https://placehold.co/320x480?text=%EC%84%BC+%EC%B9%98%ED%9E%88%EB%A1%9C'],
  ];

  for (const movie of seedData) {
    await run(
      `INSERT INTO movies (
        title, year, genre, description, poster_url, created_by, external_source, external_id
      ) VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL)`,
      movie
    );
  }
};

const initializeDatabase = async () => {
  await run('PRAGMA foreign_keys = ON');
  await run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await run(`
    CREATE TABLE IF NOT EXISTS movies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      year INTEGER,
      genre TEXT,
      description TEXT,
      poster_url TEXT,
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL
    )
  `);
  await run(`
    CREATE TABLE IF NOT EXISTS reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      movie_id INTEGER NOT NULL,
      rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 10),
      review_text TEXT,
      watched_on TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, movie_id),
      FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
      FOREIGN KEY (movie_id) REFERENCES movies (id) ON DELETE CASCADE
    )
  `);
  await ensureMovieColumns();
  await run(`
    CREATE TABLE IF NOT EXISTS watchlist (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      movie_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'plan_to_watch',
      added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, movie_id),
      CHECK(status IN ('plan_to_watch', 'watching', 'completed')),
      FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
      FOREIGN KEY (movie_id) REFERENCES movies (id) ON DELETE CASCADE
    )
  `);
  await seedMovies();
};

const formatError = (message) => ({ error: message });

const issueToken = (user) =>
  jwt.sign(
    { userId: user.id, username: user.username },
    JWT_SECRET,
    { expiresIn: '30d' }
  );

const requireAuth = (req, res, next) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json(formatError('로그인이 필요합니다.'));
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (_error) {
    return res.status(401).json(formatError('토큰이 유효하지 않습니다.'));
  }
};

const appRoot = path.join(__dirname, 'public');
app.use(cors());
app.use(express.json());
app.use(express.static(appRoot));

app.get('/api/auth/me', requireAuth, async (req, res, next) => {
  try {
    const user = await get(
      'SELECT id, username, email FROM users WHERE id = ?',
      [req.user.userId]
    );

    if (!user) {
      return res.status(401).json(formatError('사용자를 찾을 수 없습니다.'));
    }

    res.json({ user });
  } catch (error) {
    next(error);
  }
});

app.post('/api/auth/register', async (req, res, next) => {
  try {
    const username = (req.body.username || '').trim();
    const email = (req.body.email || '').trim().toLowerCase();
    const password = (req.body.password || '').trim();

    if (!username || !email || !password) {
      return res.status(400).json(formatError('닉네임, 이메일, 비밀번호를 모두 입력해주세요.'));
    }

    if (password.length < 6) {
      return res.status(400).json(formatError('비밀번호는 6자 이상이어야 합니다.'));
    }

    const existingUser = await get(
      'SELECT id FROM users WHERE username = ? OR email = ?',
      [username, email]
    );

    if (existingUser) {
      return res.status(409).json(formatError('이미 사용 중인 아이디 또는 이메일입니다.'));
    }

    const passwordHash = bcrypt.hashSync(password, 10);
    const result = await run(
      'INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)',
      [username, email, passwordHash]
    );
    const user = await get('SELECT id, username, email FROM users WHERE id = ?', [result.lastID]);
    const token = issueToken(user);

    res.status(201).json({ token, user });
  } catch (error) {
    next(error);
  }
});

app.post('/api/auth/login', async (req, res, next) => {
  try {
    const identifier = (req.body.identifier || '').trim();
    const password = (req.body.password || '').trim();

    if (!identifier || !password) {
      return res.status(400).json(formatError('아이디/이메일, 비밀번호를 모두 입력해주세요.'));
    }

    const user = await get(
      'SELECT * FROM users WHERE username = ? OR email = ?',
      [identifier, identifier]
    );

    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      return res.status(401).json(formatError('로그인 정보가 일치하지 않습니다.'));
    }

    const safeUser = {
      id: user.id,
      username: user.username,
      email: user.email,
    };
    const token = issueToken(safeUser);
    res.json({ token, user: safeUser });
  } catch (error) {
    next(error);
  }
});

app.get('/api/movies', async (req, res, next) => {
  try {
    const search = (req.query.search || '').trim();
    const baseSql = `
      SELECT m.id, m.title, m.year, m.genre, m.description, m.poster_url,
             COALESCE(ROUND(AVG(r.rating), 1), 0) as avg_rating,
             COUNT(r.id) as review_count
        FROM movies m
        LEFT JOIN reviews r ON r.movie_id = m.id
    `;
    const params = [];
    let sql = baseSql;
    if (search) {
      sql += ' WHERE m.title LIKE ? OR m.genre LIKE ? OR m.description LIKE ?';
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    sql += ' GROUP BY m.id ORDER BY m.created_at DESC';

    const rows = await all(sql, params);
    res.json(rows.map(normalizeMovie));
  } catch (error) {
    next(error);
  }
});

app.get('/api/external/movies/search', async (req, res, next) => {
  try {
    const query = (req.query.q || '').trim();
    if (!query) {
      return res.status(400).json(formatError('검색어가 필요합니다.'));
    }

    const data = await tmdbRequest('search/movie', {
      query,
      include_adult: false,
      page: 1,
    });

    const movies = (data.results || [])
      .filter((item) => item && (item.title || item.name))
      .slice(0, 20)
      .map((item) => ({
        ...normalizeTmdbMovie(item),
      }));

    res.json({
      movies,
      total: Number(data.total_results || 0),
      query,
    });
  } catch (error) {
    if (error.statusCode === 500) {
      return res.status(500).json(formatError(error.message));
    }
    next(error);
  }
});

app.post('/api/movies', requireAuth, async (req, res, next) => {
  try {
    const title = (req.body.title || '').trim();
    const year = toNumber(req.body.year);
    const genre = (req.body.genre || '').trim();
    const description = (req.body.description || '').trim();
    const posterUrl = (req.body.posterUrl || '').trim() || null;

    if (!title) {
      return res.status(400).json(formatError('영화 제목은 필수입니다.'));
    }

    if (year !== null && (year < 1880 || year > new Date().getFullYear() + 5)) {
      return res.status(400).json(formatError('올바른 개봉년도를 입력해주세요.'));
    }

    const result = await run(
      `INSERT INTO movies (title, year, genre, description, poster_url, created_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [title, year, genre, description, posterUrl, req.user.userId]
    );

    const movie = await get('SELECT * FROM movies WHERE id = ?', [result.lastID]);
    res.status(201).json(normalizeMovie(movie));
  } catch (error) {
    next(error);
  }
});

app.post('/api/movies/import', requireAuth, async (req, res, next) => {
  try {
    const tmdbId = toNumber(req.body.tmdbId);
    if (!Number.isInteger(tmdbId)) {
      return res.status(400).json(formatError('TMDB 영화 ID가 필요합니다.'));
    }

    const existing = await get(
      'SELECT id FROM movies WHERE external_source = ? AND external_id = ?',
      ['tmdb', String(tmdbId)]
    );
    if (existing) {
      const existingMovie = await get('SELECT * FROM movies WHERE id = ?', [existing.id]);
      return res.status(200).json(normalizeMovie(existingMovie));
    }

    const detail = await tmdbRequest(`movie/${tmdbId}`);
    const mapped = mapTmdbDetailToMovieInsert(detail);

    const result = await run(
      `INSERT INTO movies (
         title, year, genre, description, poster_url, created_by, external_source, external_id
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        mapped.title,
        mapped.year,
        mapped.genre,
        mapped.description,
        mapped.posterUrl,
        req.user.userId,
        mapped.externalSource,
        mapped.externalId,
      ]
    );

    const created = await get('SELECT * FROM movies WHERE id = ?', [result.lastID]);
    res.status(201).json(normalizeMovie(created));
  } catch (error) {
    if (error.statusCode === 500) {
      return res.status(500).json(formatError(error.message));
    }
    if (error.message && error.message.includes('UNIQUE')) {
      return res.status(409).json(formatError('이미 등록된 영화입니다.'));
    }
    next(error);
  }
});

app.get('/api/movies/:id', async (req, res, next) => {
  try {
    const movieId = Number(req.params.id);
    if (!Number.isInteger(movieId)) {
      return res.status(400).json(formatError('영화 ID가 잘못되었습니다.'));
    }

    const movie = await get(
      `
      SELECT m.id, m.title, m.year, m.genre, m.description, m.poster_url,
             COALESCE(ROUND(AVG(r.rating), 1), 0) as avg_rating,
             COUNT(r.id) as review_count
        FROM movies m
        LEFT JOIN reviews r ON r.movie_id = m.id
       WHERE m.id = ?
       GROUP BY m.id
      `,
      [movieId]
    );

    if (!movie) {
      return res.status(404).json(formatError('영화를 찾을 수 없습니다.'));
    }

    res.json(normalizeMovie(movie));
  } catch (error) {
    next(error);
  }
});

app.get('/api/movies/:id/reviews', async (req, res, next) => {
  try {
    const movieId = Number(req.params.id);
    if (!Number.isInteger(movieId)) {
      return res.status(400).json(formatError('영화 ID가 잘못되었습니다.'));
    }

    const movie = await get('SELECT id, title FROM movies WHERE id = ?', [movieId]);
    if (!movie) {
      return res.status(404).json(formatError('영화를 찾을 수 없습니다.'));
    }

    const reviews = await all(
      `
      SELECT r.id, r.rating, r.review_text, r.watched_on, r.created_at,
             u.id AS user_id, u.username
        FROM reviews r
        JOIN users u ON u.id = r.user_id
       WHERE r.movie_id = ?
       ORDER BY r.created_at DESC
      `,
      [movieId]
    );

    res.json(
      reviews.map((review) => ({
        ...review,
        rating: Number(review.rating),
      }))
    );
  } catch (error) {
    next(error);
  }
});

app.post('/api/movies/:id/reviews', requireAuth, async (req, res, next) => {
  try {
    const movieId = Number(req.params.id);
    const rating = toNumber(req.body.rating);
    const reviewText = (req.body.reviewText || '').trim();
    const watchedOn = (req.body.watchedOn || '').trim() || null;

    if (!Number.isInteger(movieId)) {
      return res.status(400).json(formatError('영화 ID가 잘못되었습니다.'));
    }

    if (!rating || rating < 1 || rating > 10) {
      return res.status(400).json(formatError('평점은 1~10 사이 정수여야 합니다.'));
    }

    const movie = await get('SELECT id FROM movies WHERE id = ?', [movieId]);
    if (!movie) {
      return res.status(404).json(formatError('영화를 찾을 수 없습니다.'));
    }

    await run(
      `
      INSERT INTO reviews (user_id, movie_id, rating, review_text, watched_on)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(user_id, movie_id) DO UPDATE SET
        rating = excluded.rating,
        review_text = excluded.review_text,
        watched_on = excluded.watched_on,
        updated_at = CURRENT_TIMESTAMP
      `,
      [req.user.userId, movieId, rating, reviewText, watchedOn]
    );

    const review = await get(
      `
      SELECT r.id, r.rating, r.review_text, r.watched_on, r.created_at,
             u.username, u.id AS user_id
        FROM reviews r
        JOIN users u ON u.id = r.user_id
       WHERE r.user_id = ? AND r.movie_id = ?
      `,
      [req.user.userId, movieId]
    );

    res.status(201).json({
      ...review,
      rating: Number(review.rating),
    });
  } catch (error) {
    next(error);
  }
});

app.delete('/api/reviews/:id', requireAuth, async (req, res, next) => {
  try {
    const reviewId = Number(req.params.id);
    if (!Number.isInteger(reviewId)) {
      return res.status(400).json(formatError('리뷰 ID가 잘못되었습니다.'));
    }

    const result = await run(
      'DELETE FROM reviews WHERE id = ? AND user_id = ?',
      [reviewId, req.user.userId]
    );

    if (result.changes === 0) {
      return res.status(404).json(formatError('리뷰를 찾을 수 없습니다.'));
    }

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

app.post('/api/movies/:id/watchlist', requireAuth, async (req, res, next) => {
  try {
    const movieId = Number(req.params.id);
    const status = (req.body.status || 'plan_to_watch').trim();
    const allowed = new Set(['plan_to_watch', 'watching', 'completed']);

    if (!Number.isInteger(movieId)) {
      return res.status(400).json(formatError('영화 ID가 잘못되었습니다.'));
    }

    if (!allowed.has(status)) {
      return res.status(400).json(formatError('watchlist 상태가 올바르지 않습니다.'));
    }

    const movie = await get('SELECT id FROM movies WHERE id = ?', [movieId]);
    if (!movie) {
      return res.status(404).json(formatError('영화를 찾을 수 없습니다.'));
    }

    await run(
      `
      INSERT INTO watchlist (user_id, movie_id, status)
      VALUES (?, ?, ?)
      ON CONFLICT(user_id, movie_id) DO UPDATE SET
        status = excluded.status
      `,
      [req.user.userId, movieId, status]
    );

    res.json({ success: true, movieId, status });
  } catch (error) {
    next(error);
  }
});

app.get('/api/me/watchlist', requireAuth, async (req, res, next) => {
  try {
    const rows = await all(
      `
      SELECT w.movie_id, w.status, w.added_at,
             m.title, m.year, m.poster_url
        FROM watchlist w
        JOIN movies m ON m.id = w.movie_id
       WHERE w.user_id = ?
       ORDER BY w.added_at DESC
      `,
      [req.user.userId]
    );
    res.json(rows);
  } catch (error) {
    next(error);
  }
});

app.delete('/api/me/watchlist/:movieId', requireAuth, async (req, res, next) => {
  try {
    const movieId = Number(req.params.movieId);
    if (!Number.isInteger(movieId)) {
      return res.status(400).json(formatError('영화 ID가 잘못되었습니다.'));
    }

    await run(
      'DELETE FROM watchlist WHERE user_id = ? AND movie_id = ?',
      [req.user.userId, movieId]
    );
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

app.get('/api/me/reviews', requireAuth, async (req, res, next) => {
  try {
    const rows = await all(
      `
      SELECT r.id, r.rating, r.review_text, r.watched_on, r.created_at,
             m.id AS movie_id, m.title
        FROM reviews r
        JOIN movies m ON m.id = r.movie_id
       WHERE r.user_id = ?
       ORDER BY r.created_at DESC
      `,
      [req.user.userId]
    );

    res.json(
      rows.map((row) => ({
        ...row,
        rating: Number(row.rating),
      }))
    );
  } catch (error) {
    next(error);
  }
});

app.use('/api', (req, res) => {
  res.status(404).json(formatError('요청한 API가 존재하지 않습니다.'));
});

app.get('*', (_req, res) => {
  res.sendFile(path.join(appRoot, 'index.html'));
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json(formatError('서버 오류가 발생했습니다.'));
});

initializeDatabase()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Movie R MVP is running on http://localhost:${PORT}`);
    });
  })
  .catch((error) => {
    console.error('DB 초기화 실패:', error);
    process.exit(1);
  });
