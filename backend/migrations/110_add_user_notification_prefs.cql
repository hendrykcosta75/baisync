-- User-level notification preferences. Both default to "enabled" semantically:
-- the column is NULL for legacy rows and the read path interprets NULL as
-- true (notifications on by default). New users get explicit `true` from
-- the registration handler.
ALTER TABLE inertial_eclipse.users ADD notify_email boolean;
ALTER TABLE inertial_eclipse.users ADD notify_system boolean;
