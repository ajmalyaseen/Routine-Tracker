-- ==============================================================================
-- ROUTINE TRACKER UPGRADE MIGRATION: DATE SUPPORT + START & END TIMES
-- ==============================================================================
-- 1. Create table public.routines if it does not exist
CREATE TABLE IF NOT EXISTS public.routines (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL DEFAULT 'routine-master-user',
    title TEXT NOT NULL,
    category TEXT DEFAULT 'General',
    scheduled_date DATE NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::DATE,
    start_time TIME NOT NULL,
    end_time TIME,
    done BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Add columns if table already exists (safe idempotent migrations)
ALTER TABLE public.routines ADD COLUMN IF NOT EXISTS scheduled_date DATE DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::DATE;
ALTER TABLE public.routines ADD COLUMN IF NOT EXISTS start_time TIME;
ALTER TABLE public.routines ADD COLUMN IF NOT EXISTS end_time TIME;
ALTER TABLE public.routines ADD COLUMN IF NOT EXISTS user_id TEXT DEFAULT 'routine-master-user';
ALTER TABLE public.routines ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'General';
ALTER TABLE public.routines ADD COLUMN IF NOT EXISTS done BOOLEAN DEFAULT FALSE;
ALTER TABLE public.routines ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE public.routines ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- 3. Create performance indexes for date-scoped retrieval & chronological ordering
CREATE INDEX IF NOT EXISTS idx_routines_user_scheduled_date ON public.routines (user_id, scheduled_date);
CREATE INDEX IF NOT EXISTS idx_routines_scheduled_date ON public.routines (scheduled_date);
CREATE INDEX IF NOT EXISTS idx_routines_chronological ON public.routines (scheduled_date, start_time ASC);

-- 4. Enable Row Level Security (RLS) and permissive access for the Routine Tracker
ALTER TABLE public.routines ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'routines' AND policyname = 'Allow all routine operations'
    ) THEN
        CREATE POLICY "Allow all routine operations" ON public.routines
            FOR ALL
            USING (true)
            WITH CHECK (true);
    END IF;
END $$;

-- 5. Safe Data Migration: Populate public.routines from existing user_discipline_state
DO $$
DECLARE
    rec RECORD;
    d_key TEXT;
    item JSONB;
    s_date DATE;
    s_time TIME;
    e_time TIME;
    raw_time TEXT;
    time_parts TEXT[];
BEGIN
    -- Check if user_discipline_state table exists
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'user_discipline_state') THEN
        FOR rec IN SELECT user_id, state FROM public.user_discipline_state LOOP
            -- Process routinesByDate
            IF rec.state ? 'routinesByDate' AND jsonb_typeof(rec.state->'routinesByDate') = 'object' THEN
                FOR d_key IN SELECT jsonb_object_keys(rec.state->'routinesByDate') LOOP
                    BEGIN
                        s_date := d_key::DATE;
                    EXCEPTION WHEN OTHERS THEN
                        s_date := (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::DATE;
                    END;
                    
                    FOR item IN SELECT * FROM jsonb_array_elements(rec.state->'routinesByDate'->d_key) LOOP
                        raw_time := COALESCE(item->>'time', '08:00');
                        -- Parse start and optional end time
                        IF raw_time LIKE '%-%' THEN
                            time_parts := string_to_array(raw_time, '-');
                            BEGIN
                                s_time := trim(regexp_replace(time_parts[1], '\s*\([^)]*\)', '', 'g'))::TIME;
                            EXCEPTION WHEN OTHERS THEN
                                s_time := '08:00'::TIME;
                            END;
                            BEGIN
                                e_time := trim(regexp_replace(time_parts[2], '\s*\([^)]*\)', '', 'g'))::TIME;
                            EXCEPTION WHEN OTHERS THEN
                                e_time := NULL;
                            END;
                        ELSE
                            BEGIN
                                s_time := trim(regexp_replace(raw_time, '\s*\([^)]*\)', '', 'g'))::TIME;
                            EXCEPTION WHEN OTHERS THEN
                                s_time := '08:00'::TIME;
                            END;
                            e_time := NULL;
                        END IF;
                        
                        INSERT INTO public.routines (
                            id, user_id, title, category, scheduled_date, start_time, end_time, done, updated_at
                        ) VALUES (
                            COALESCE(item->>'id', 'rt-' || extract(epoch from now())::bigint || '-' || md5(random()::text)),
                            rec.user_id,
                            COALESCE(item->>'title', 'Untitled Routine'),
                            COALESCE(item->>'category', 'General'),
                            s_date,
                            s_time,
                            e_time,
                            COALESCE((item->>'done')::BOOLEAN, false),
                            NOW()
                        )
                        ON CONFLICT (id) DO UPDATE SET
                            title = EXCLUDED.title,
                            category = EXCLUDED.category,
                            scheduled_date = EXCLUDED.scheduled_date,
                            start_time = EXCLUDED.start_time,
                            end_time = EXCLUDED.end_time,
                            done = EXCLUDED.done,
                            updated_at = NOW();
                    END LOOP;
                END LOOP;
            END IF;
        END LOOP;
    END IF;
END $$;
