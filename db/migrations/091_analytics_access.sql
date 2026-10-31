-- Per course: demand for its lectures from students outside it, and how it is handled.
CREATE VIEW v_course_access_demand AS
SELECT co.course_id, co.code, co.title,
       count(*)                                                          AS total_requests,
       count(*) FILTER (WHERE r.status = 'pending')                      AS pending,
       count(*) FILTER (WHERE r.status = 'approved')                     AS approved,
       count(*) FILTER (WHERE r.status = 'rejected')                     AS rejected,
       round(100.0 * count(*) FILTER (WHERE r.status = 'approved')
             / nullif(count(*) FILTER (WHERE r.status <> 'pending'), 0), 1) AS approval_rate_pct,
       round(avg(extract(epoch FROM r.decided_at - r.requested_at) / 3600)::numeric, 1)
                                                                         AS avg_hours_to_decide,
       count(DISTINCT r.student_id)                                      AS distinct_requesters
FROM access_request r
JOIN lecture     l ON l.lecture_id = r.lecture_id
JOIN course     co ON co.course_id = l.course_id
GROUP BY co.course_id, co.code, co.title;

-- Pending-request badge count per approver.
CREATE VIEW v_pending_by_approver AS
SELECT t.uploaded_by AS approver_id, u.full_name, count(*) AS pending
FROM access_request r
JOIN transcript t ON t.lecture_id = r.lecture_id
JOIN app_user  u ON u.user_id = t.uploaded_by
WHERE r.status = 'pending'
GROUP BY t.uploaded_by, u.full_name;
