-- 10_users.sql  (owner: Member B)
-- Demo accounts. Every account shares the password demo1234 (bcrypt, cost 12) -- demo only.
-- Run by `npm run db:seed` as the schema owner (MIGRATION_DATABASE_URL), BEFORE
-- 20_courses_lectures.sql, which looks these users up by e-mail.
--
-- The hash below is bcrypt of 'demo1234'. app_user.password_hash CHECKs the shape
-- (^\$2[aby]\$\d{2}\$.{53}$), so keep the 60-character format if you change the password.

INSERT INTO app_user (email, full_name, password_hash, role) VALUES
    ('admin@pes.edu',  'Admin',     '$2a$12$4LbZ/QFYm.W6nokyWqsTq.wuIcFZlCzqs/zjLeypLYKFGWfZvJmje', 'admin'),
    ('rao@pes.edu',    'Dr. Rao',   '$2a$12$4LbZ/QFYm.W6nokyWqsTq.wuIcFZlCzqs/zjLeypLYKFGWfZvJmje', 'instructor'),
    ('iyer@pes.edu',   'Dr. Iyer',  '$2a$12$4LbZ/QFYm.W6nokyWqsTq.wuIcFZlCzqs/zjLeypLYKFGWfZvJmje', 'instructor'),
    ('menon@pes.edu',  'Dr. Menon', '$2a$12$4LbZ/QFYm.W6nokyWqsTq.wuIcFZlCzqs/zjLeypLYKFGWfZvJmje', 'instructor'),
    ('asha@pes.edu',   'Asha',      '$2a$12$4LbZ/QFYm.W6nokyWqsTq.wuIcFZlCzqs/zjLeypLYKFGWfZvJmje', 'student'),
    ('ben@pes.edu',    'Ben',       '$2a$12$4LbZ/QFYm.W6nokyWqsTq.wuIcFZlCzqs/zjLeypLYKFGWfZvJmje', 'student'),
    ('chitra@pes.edu', 'Chitra',    '$2a$12$4LbZ/QFYm.W6nokyWqsTq.wuIcFZlCzqs/zjLeypLYKFGWfZvJmje', 'student');