-- Used by docker-compose.dev.yml: a separate database for the automated tests (they DROP and recreate its schema).
CREATE DATABASE maliren_test OWNER maliren;
