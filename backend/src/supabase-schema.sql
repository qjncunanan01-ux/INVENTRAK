-- INVENTRAK Supabase Schema
-- Run this in the Supabase SQL Editor to create all tables.

-- ============================================================
-- Products catalog
-- ============================================================
CREATE TABLE IF NOT EXISTS products (
  id        INTEGER PRIMARY KEY,
  idx       INTEGER NOT NULL DEFAULT 0,
  data      JSONB NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS products_idx ON products(idx);

-- ============================================================
-- Inventory (items + locations meta)
-- ============================================================
CREATE TABLE IF NOT EXISTS inventory (
  id        INTEGER PRIMARY KEY,
  idx       INTEGER NOT NULL DEFAULT 0,
  data      JSONB NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS inventory_meta (
  id        TEXT PRIMARY KEY DEFAULT '_meta',
  data      JSONB NOT NULL DEFAULT '[]'
);

-- ============================================================
-- Stock movements
-- ============================================================
CREATE TABLE IF NOT EXISTS movements (
  id        INTEGER PRIMARY KEY,
  idx       INTEGER NOT NULL DEFAULT 0,
  data      JSONB NOT NULL DEFAULT '{}'
);

-- ============================================================
-- Order inquiries
-- ============================================================
CREATE TABLE IF NOT EXISTS inquiries (
  id        INTEGER PRIMARY KEY,
  idx       INTEGER NOT NULL DEFAULT 0,
  data      JSONB NOT NULL DEFAULT '{}'
);

-- ============================================================
-- Stock adjustments
-- ============================================================
CREATE TABLE IF NOT EXISTS stock_adjustments (
  id        INTEGER PRIMARY KEY,
  idx       INTEGER NOT NULL DEFAULT 0,
  data      JSONB NOT NULL DEFAULT '{}'
);

-- ============================================================
-- Stock transfers
-- ============================================================
CREATE TABLE IF NOT EXISTS stock_transfers (
  id        INTEGER PRIMARY KEY,
  idx       INTEGER NOT NULL DEFAULT 0,
  data      JSONB NOT NULL DEFAULT '{}'
);

-- ============================================================
-- Users
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
  id        INTEGER PRIMARY KEY,
  idx       INTEGER NOT NULL DEFAULT 0,
  data      JSONB NOT NULL DEFAULT '{}'
);

-- ============================================================
-- Sales
-- ============================================================
CREATE TABLE IF NOT EXISTS sales (
  id        INTEGER PRIMARY KEY,
  idx       INTEGER NOT NULL DEFAULT 0,
  data      JSONB NOT NULL DEFAULT '{}'
);

-- ============================================================
-- Alerts
-- ============================================================
CREATE TABLE IF NOT EXISTS alerts (
  id        INTEGER PRIMARY KEY,
  idx       INTEGER NOT NULL DEFAULT 0,
  data      JSONB NOT NULL DEFAULT '{}'
);

-- ============================================================
-- Verification codes (signup email verification)
-- ============================================================
CREATE TABLE IF NOT EXISTS verification_codes (
  id        TEXT PRIMARY KEY,
  data      JSONB NOT NULL DEFAULT '{}'
);

-- ============================================================
-- Password reset tokens
-- ============================================================
CREATE TABLE IF NOT EXISTS reset_tokens (
  id        TEXT PRIMARY KEY,
  data      JSONB NOT NULL DEFAULT '{}'
);
