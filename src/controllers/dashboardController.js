// src/controllers/dashboardController.js
const { query, queryOne, sql } = require('../config/db');
const { success } = require('../utils/response');

// ── GET /api/dashboard/summary ────────────────────────────────────────────
// Returns all KPIs needed by the Dashboard module in one call
exports.getSummary = async (req, res, next) => {
  try {
    const { schoolId } = req.user;
    const sid = { type: sql.UniqueIdentifier, value: schoolId };

    // Run all aggregates in parallel
    const [
      studentStats,
      staffStats,
      feeStats,
      attendanceTrend,
      absentTeachers,
      feeByClass,
      enrollmentByClass,
      recentActivity,
    ] = await Promise.all([

      // Student counts
      queryOne(
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) AS active
         FROM students WHERE school_id = @sid AND deleted_at IS NULL`,
        { sid }
      ),

      // Staff counts + today's attendance
      query(
        `SELECT
           COUNT(DISTINCT sm.id) AS total_staff,
           SUM(CASE WHEN CONVERT(DATE, sa.date) = CONVERT(DATE, GETUTCDATE())
                    AND sa.status = 'present' THEN 1 ELSE 0 END) AS present_today
         FROM school_members sm
         LEFT JOIN staff_attendance sa ON sa.staff_id = sm.user_id AND sa.school_id = @sid
                   AND CONVERT(DATE, sa.date) = CONVERT(DATE, GETUTCDATE())
         WHERE sm.school_id = @sid AND sm.is_active = 1 AND sm.deleted_at IS NULL
           AND sm.role IN ('teacher','staff','admin')`,
        { sid }
      ),

      // Fee aggregates
      queryOne(
        `SELECT
           SUM(paid_paise)    AS total_paid_paise,
           SUM(pending_paise) AS total_pending_paise,
           COUNT(CASE WHEN status = 'pending' THEN 1 END) AS defaulters
         FROM student_fee_accounts
         WHERE school_id = @sid AND deleted_at IS NULL`,
        { sid }
      ),

      // Attendance % last 7 days
      query(
        `SELECT CONVERT(DATE, date) AS att_date,
                COUNT(*) AS total,
                SUM(CASE WHEN status = 'present' THEN 1 ELSE 0 END) AS present
         FROM student_attendance
         WHERE school_id = @sid AND date >= DATEADD(DAY, -7, GETUTCDATE())
         GROUP BY CONVERT(DATE, date)
         ORDER BY att_date`,
        { sid }
      ),

      // Absent teachers today (with name)
      query(
        `SELECT u.full_name, sp.designation,
                STRING_AGG(sub.name, ', ') AS subjects
         FROM staff_attendance sa
         JOIN users u ON u.id = sa.staff_id
         LEFT JOIN staff_profiles sp ON sp.member_id = sa.staff_id AND sp.school_id = @sid
         LEFT JOIN teacher_assignments ta ON ta.staff_id = sa.staff_id AND ta.school_id = @sid
         LEFT JOIN subjects sub ON sub.id = ta.subject_id
         WHERE sa.school_id = @sid
           AND CONVERT(DATE, sa.date) = CONVERT(DATE, GETUTCDATE())
           AND sa.status = 'absent'
         GROUP BY u.full_name, sp.designation`,
        { sid }
      ),

      // Fee paid/pending per class
      query(
        `SELECT g.name AS class_name,
                SUM(sfa.paid_paise)    AS paid_paise,
                SUM(sfa.pending_paise) AS pending_paise
         FROM student_fee_accounts sfa
         JOIN enrolments e ON e.student_id = sfa.student_id AND e.school_id = @sid
         JOIN sections sc ON sc.id = e.section_id
         JOIN grades g ON g.id = sc.grade_id
         WHERE sfa.school_id = @sid AND sfa.deleted_at IS NULL
         GROUP BY g.name, g.numeric_order
         ORDER BY g.numeric_order`,
        { sid }
      ),

      // Enrollment count per class
      query(
        `SELECT g.name AS class_name, g.numeric_order,
                COUNT(DISTINCT e.student_id) AS student_count
         FROM enrolments e
         JOIN sections sc ON sc.id = e.section_id
         JOIN grades g ON g.id = sc.grade_id
         JOIN academic_years ay ON ay.id = e.academic_year_id AND ay.is_current = 1
         WHERE e.school_id = @sid AND e.is_active = 1 AND e.deleted_at IS NULL
         GROUP BY g.name, g.numeric_order
         ORDER BY g.numeric_order`,
        { sid }
      ),

      // Recent audit logs (last 10 actions)
      query(
        `SELECT TOP 10
           al.action, al.table_name, al.created_at,
           u.full_name AS actor
         FROM audit_logs al
         LEFT JOIN users u ON u.id = al.actor_id
         WHERE al.school_id = @sid
         ORDER BY al.created_at DESC`,
        { sid }
      ),
    ]);

    const attendanceTrendFormatted = attendanceTrend.recordset.map((r) => ({
      date:    r.att_date,
      rate:    r.total > 0 ? Math.round((r.present / r.total) * 100) : 0,
      present: r.present,
      total:   r.total,
    }));

    return success(res, {
      students: studentStats,
      staff: staffStats.recordset[0],
      fees: feeStats,
      attendanceTrend: attendanceTrendFormatted,
      absentTeachers: absentTeachers.recordset,
      feeByClass: feeByClass.recordset,
      enrollmentByClass: enrollmentByClass.recordset,
      recentActivity: recentActivity.recordset,
    });
  } catch (err) { next(err); }
};

// ── GET /api/dashboard/quick-stats ────────────────────────────────────────
exports.getQuickStats = async (req, res, next) => {
  try {
    const { schoolId } = req.user;
    const sid = { type: sql.UniqueIdentifier, value: schoolId };

    const stats = await queryOne(
      `SELECT
         (SELECT COUNT(*) FROM grades WHERE school_id = @sid AND is_active=1 AND deleted_at IS NULL) AS total_classes,
         (SELECT COUNT(*) FROM sections WHERE school_id = @sid AND is_active=1 AND deleted_at IS NULL) AS total_sections,
         (SELECT COUNT(DISTINCT name) FROM subjects WHERE school_id = @sid AND is_active=1 AND deleted_at IS NULL) AS total_subjects,
         (SELECT CAST(
            CAST(SUM(CASE WHEN status='present' THEN 1.0 ELSE 0 END) AS FLOAT)
            / NULLIF(COUNT(*),0) * 100 AS DECIMAL(5,1))
          FROM student_attendance
          WHERE school_id = @sid
            AND date >= DATEADD(MONTH,-1,GETUTCDATE())
         ) AS avg_attendance_last_month`,
      { sid }
    );

    return success(res, stats);
  } catch (err) { next(err); }
};



// ── GET /api/dashboard/kpi-trends ─────────────────────────────────────────
// Real month-over-month % change for the 4 dashboard KPI cards
exports.getKpiTrends = async (req, res, next) => {
  try {
    const { schoolId } = req.user;
    const sid = { type: sql.UniqueIdentifier, value: schoolId };

    const row = await queryOne(`
      DECLARE @today DATE = CONVERT(DATE, GETUTCDATE());
      DECLARE @lastMonth DATE = DATEADD(MONTH, -1, @today);
      DECLARE @thisMonthStart DATE = DATEFROMPARTS(YEAR(@today), MONTH(@today), 1);
      DECLARE @lastMonthStart DATE = DATEADD(MONTH, -1, @thisMonthStart);

      SELECT
        (SELECT COUNT(*) FROM students WHERE school_id=@sid AND is_active=1 AND deleted_at IS NULL) AS students_now,
        (SELECT COUNT(*) FROM students WHERE school_id=@sid AND created_at <= @lastMonth AND (deleted_at IS NULL OR deleted_at > @lastMonth)) AS students_last_month,

        (SELECT COUNT(*) FROM school_members WHERE school_id=@sid AND role='teacher' AND is_active=1 AND deleted_at IS NULL) AS staff_now,
        (SELECT COUNT(*) FROM school_members WHERE school_id=@sid AND role='teacher' AND created_at <= @lastMonth AND (deleted_at IS NULL OR deleted_at > @lastMonth)) AS staff_last_month,

        (SELECT ISNULL(SUM(amount_paise),0) FROM fee_payments WHERE school_id=@sid AND is_void=0 AND payment_date >= @thisMonthStart) AS fee_collected_this_month,
        (SELECT ISNULL(SUM(amount_paise),0) FROM fee_payments WHERE school_id=@sid AND is_void=0 AND payment_date >= @lastMonthStart AND payment_date < @thisMonthStart) AS fee_collected_last_month,

        (
          (SELECT ISNULL(SUM(total_paise),0) FROM fee_invoices WHERE school_id=@sid AND deleted_at IS NULL AND invoice_date <= @today)
          - (SELECT ISNULL(SUM(amount_paise),0) FROM fee_payments WHERE school_id=@sid AND is_void=0 AND payment_date <= @today)
        ) AS fee_pending_now,
        (
          (SELECT ISNULL(SUM(total_paise),0) FROM fee_invoices WHERE school_id=@sid AND deleted_at IS NULL AND invoice_date <= @lastMonth)
          - (SELECT ISNULL(SUM(amount_paise),0) FROM fee_payments WHERE school_id=@sid AND is_void=0 AND payment_date <= @lastMonth)
        ) AS fee_pending_last_month
    `, { sid });

    const pct = (now, prev) => {
      now = Number(now) || 0;
      prev = Number(prev) || 0;
      if (prev === 0) return now === 0 ? 0 : 100;
      return Math.round(((now - prev) / prev) * 1000) / 10;
    };

    return success(res, {
      students: pct(row.students_now, row.students_last_month),
      staff: pct(row.staff_now, row.staff_last_month),
      feeCollected: pct(row.fee_collected_this_month, row.fee_collected_last_month),
      // Pending ke liye "kam hona" achi baat hai, isliye sign invert kiya —
      // pending ghatne par green/up dikhega, badhne par red/down.
      feePending: -pct(row.fee_pending_now, row.fee_pending_last_month),
    });
  } catch (err) { next(err); }
};
