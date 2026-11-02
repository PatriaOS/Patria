-- LEG02: letterbox design supersedes letter_recipient_devices.
-- Non-admin authors must never read other members' device_keys (least access).
-- shareR is sealed to letterbox_keys.public_key instead. Kept as a no-op so
-- migration history stays linear if an earlier draft of this file was applied.
SELECT 1;
