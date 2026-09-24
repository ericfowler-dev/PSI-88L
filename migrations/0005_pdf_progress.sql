-- Checkpoints are committed atomically with extracted passages.
alter table documents add column processed_pages integer not null default 0;
alter table documents add column total_pages integer not null default 0;
