-- Migration 010: Create secondary indexes

USE inertial_eclipse;

-- Email lookup for user login (already created in 002, included here for reference)
-- CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);

-- Share token lookup for assistant sharing
CREATE INDEX IF NOT EXISTS idx_assistants_share_token ON assistants (share_token);

-- Contact number lookup for incoming messages routing
CREATE INDEX IF NOT EXISTS idx_conversations_contact_number ON conversations (contact_number);

-- Vector embedding index removed: scylla-rust 0.15 cannot parse VECTOR types.
-- Re-add when driver is upgraded to 1.x+
