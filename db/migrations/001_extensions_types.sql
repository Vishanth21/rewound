CREATE EXTENSION IF NOT EXISTS vector; -- pgvector: vector type, <=> operator, HNSW index
CREATE TYPE user_role AS ENUM ('student', 'instructor', 'admin');
CREATE TYPE request_status AS ENUM ('pending', 'approved', 'rejected');
