-- Migration 087: Persist raw media bytes on messages
--
-- Storing the decoded base64 alongside each message enables two things:
--   1. Rendering images/documents inline in the Conversations tab.
--   2. Feeding the original media back to vision-capable LLMs on follow-up
--      turns, so the model keeps visual context instead of hallucinating that
--      it "cannot see images".
--
-- Capped at ~10MB by upstream validation (messaging.rs media size check).

USE inertial_eclipse;

ALTER TABLE messages ADD media_base64 text;
