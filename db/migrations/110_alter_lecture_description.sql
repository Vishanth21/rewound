-- 110_alter_lecture_description.sql  (owner: Member A)
-- ALTER demo: a later, additive migration. Lectures gain an optional description.
ALTER TABLE lecture ADD COLUMN description varchar(1000);
ALTER TABLE lecture ADD CONSTRAINT chk_lecture_description
    CHECK (description IS NULL OR btrim(description) <> '');
GRANT SELECT (description), INSERT (description), UPDATE (description) ON lecture TO lecturelens_app;
