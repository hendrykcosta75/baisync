-- Migration 013: Add ai_enabled column to conversations table
-- Allows users to pause the AI agent on a per-conversation basis

USE inertial_eclipse;

ALTER TABLE conversations ADD ai_enabled boolean;
