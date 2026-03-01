-- Add 'resume' value to PipelineTriggerType enum
ALTER TYPE unerr."PipelineTriggerType" ADD VALUE IF NOT EXISTS 'resume';
