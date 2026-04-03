-- Migration 012: Add config_split_messages to assistants table

USE inertial_eclipse;

ALTER TABLE assistants ADD config_split_messages boolean;
