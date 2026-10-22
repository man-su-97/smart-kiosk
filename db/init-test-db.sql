-- Runs once when the Postgres container is first created.
-- The app uses "pickup"; automated tests use their own "pickup_test" database.
CREATE DATABASE pickup_test;
