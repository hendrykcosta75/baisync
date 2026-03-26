-- Migration 016: Add typing indicator toggle to assistants

USE inertial_eclipse;

ALTER TABLE assistants ADD config_typing_indicator boolean;
