CREATE TABLE app_user (
user_id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
email varchar(254) NOT NULL
CHECK (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
full_name varchar(100) NOT NULL CHECK (btrim(full_name) <> ''),
password_hash text NOT NULL -- bcrypt only, never plain text
CHECK (password_hash ~ '^\$2[aby]\$\d{2}\$.{53}$'),
role user_role NOT NULL,
created_at timestamptz NOT NULL DEFAULT now()
);
-- Expression index: e-mails are unique case-insensitively (A@x.com = a@x.com)
CREATE UNIQUE INDEX uq_app_user_email ON app_user (lower(email));

-- Generic trigger: the user referenced by column TG_ARGV[0] must have role TG_ARGV[1].
CREATE FUNCTION fn_require_role() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
v_uid integer := (to_jsonb(NEW) ->> TG_ARGV[0])::integer;
v_role user_role;
BEGIN
SELECT role INTO v_role FROM app_user WHERE user_id = v_uid;
IF v_role IS DISTINCT FROM TG_ARGV[1]::user_role THEN
RAISE EXCEPTION '%.%: user % must be a %, but is %',
TG_TABLE_NAME, TG_ARGV[0], v_uid, TG_ARGV[1], coalesce(v_role::text, 'missing')
USING ERRCODE = 'check_violation';
END IF;
RETURN NEW;
END $$;
