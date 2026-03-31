-- Migration 025: Add assistant_description column to accepted_shares

USE inertial_eclipse;

ALTER TABLE accepted_shares ADD assistant_description text;
