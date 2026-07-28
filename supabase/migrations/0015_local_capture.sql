-- Local (no-bot) capture. A desktop recorder on an operator's machine captures
-- the room or the computer's own audio and streams finalized turns straight
-- into live_utterances, so a host who refuses a bot cannot block the capture.
--
-- Modelled as a new source_type rather than a parallel "capture_mode" column:
-- source_type is already the axis that decides how a meeting is captured, and
-- 'local' simply means "no bot, no URL to join - an operator brought the audio".
--
-- Two consequences fall out of that:
--   * live_enabled stops being bot-only. Local meetings are the other source
--     that can drive the public live page.
--   * source_url is null for local meetings (nothing to join), which the
--     existing schema already permits.
--
-- schedules is deliberately NOT widened: a recurring capture has to be able to
-- fire unattended, and a local recording needs a human to start it.

alter table meetings drop constraint if exists meetings_source_type_check;
alter table meetings
  add constraint meetings_source_type_check
  check (source_type in ('zoom', 'teams', 'meet', 'stream', 'upload', 'local'));
