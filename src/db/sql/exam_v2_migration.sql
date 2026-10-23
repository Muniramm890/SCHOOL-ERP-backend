-- ============================================================================
-- exam_v2_migration.sql  -  Exam Management + Results hardening
-- Idempotent, single batch (no GO), safe to re-run. Run once in the Azure SQL editor.
--   1) exam_groups.published_at / published_by  (real publish audit, replaces "updated_at" guess)
--   2) restores exam_results.status = pass | fail | incomplete  (publish used to overwrite it with 'published')
--   3) backfills school_rank (rank among all sections of the same class/grade)
--   4) CHECK constraints (WITH NOCHECK: protect new writes, never fail on old rows)
--   5) indexes for analytics + student lookups, unique exam name per academic year (only if no duplicates exist)
-- ============================================================================
SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRY
  BEGIN TRAN;

  -- 1) publish audit columns ---------------------------------------------------
  IF COL_LENGTH('dbo.exam_groups', 'published_at') IS NULL
    ALTER TABLE dbo.exam_groups ADD published_at datetime2 NULL;
  IF COL_LENGTH('dbo.exam_groups', 'published_by') IS NULL
    ALTER TABLE dbo.exam_groups ADD published_by uniqueidentifier NULL;

  IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_exam_groups_published_by')
    EXEC(N'ALTER TABLE dbo.exam_groups ADD CONSTRAINT FK_exam_groups_published_by FOREIGN KEY (published_by) REFERENCES dbo.users(id)');

  -- already-published exams: best available date is the last update
  EXEC(N'UPDATE dbo.exam_groups SET published_at = updated_at WHERE status = ''published'' AND published_at IS NULL');

  -- 2) restore pass/fail/incomplete on rows that publish/unpublish overwrote ------
  --    rule (same as the compute engine): any subject missing -> incomplete;
  --    absent / malpractice, or marks below passing marks -> fail; leave / tc / exempted are ignored.
  UPDATE er
     SET status = CASE WHEN x.missing_cnt > 0 THEN 'incomplete'
                       WHEN x.fail_cnt > 0 THEN 'fail'
                       ELSE 'pass' END
    FROM dbo.exam_results er
   OUTER APPLY (
     SELECT SUM(CASE WHEN em.id IS NULL THEN 1 ELSE 0 END) AS missing_cnt,
            SUM(CASE WHEN em.id IS NOT NULL AND (
                       em.status IN ('absent', 'malpractice')
                       OR (es.is_grade_only = 0 AND em.status = 'present' AND ISNULL(em.marks_obtained, 0) < es.passing_marks)
                     ) THEN 1 ELSE 0 END) AS fail_cnt
       FROM dbo.exam_subjects es
       LEFT JOIN dbo.exam_marks em ON em.exam_subject_id = es.id AND em.student_id = er.student_id
      WHERE es.exam_group_id = er.exam_group_id AND es.section_id = er.section_id AND es.deleted_at IS NULL
   ) x
   WHERE er.status NOT IN ('pass', 'fail', 'incomplete');

  -- 3) school_rank = rank among all sections of the same class (grade) for that exam ----
  ;WITH r AS (
    SELECT er.id,
           RANK() OVER (PARTITION BY er.exam_group_id, sc.grade_id ORDER BY er.percentage DESC) AS grade_rank
      FROM dbo.exam_results er
      JOIN dbo.sections sc ON sc.id = er.section_id
     WHERE er.status <> 'incomplete'
  )
  UPDATE er SET school_rank = r.grade_rank
    FROM dbo.exam_results er JOIN r ON r.id = er.id;

  -- 4) CHECK constraints (NOCHECK = existing rows are not validated, new/updated rows are) -----
  IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_exam_marks_status')
    EXEC(N'ALTER TABLE dbo.exam_marks WITH NOCHECK ADD CONSTRAINT CK_exam_marks_status CHECK (status IN (''present'',''absent'',''leave'',''tc'',''malpractice'',''exempted''))');
  IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_exam_marks_nonneg')
    EXEC(N'ALTER TABLE dbo.exam_marks WITH NOCHECK ADD CONSTRAINT CK_exam_marks_nonneg CHECK (marks_obtained IS NULL OR marks_obtained >= 0)');
  IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_exam_subjects_marks')
    EXEC(N'ALTER TABLE dbo.exam_subjects WITH NOCHECK ADD CONSTRAINT CK_exam_subjects_marks CHECK (max_marks >= 0 AND passing_marks >= 0 AND passing_marks <= max_marks)');
  IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_exam_groups_dates')
    EXEC(N'ALTER TABLE dbo.exam_groups WITH NOCHECK ADD CONSTRAINT CK_exam_groups_dates CHECK (end_date >= start_date)');
  IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_exam_groups_weightage')
    EXEC(N'ALTER TABLE dbo.exam_groups WITH NOCHECK ADD CONSTRAINT CK_exam_groups_weightage CHECK (weightage_percent >= 0 AND weightage_percent <= 100)');
  IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_exam_groups_status')
    EXEC(N'ALTER TABLE dbo.exam_groups WITH NOCHECK ADD CONSTRAINT CK_exam_groups_status CHECK (status IN (''draft'',''scheduled'',''ongoing'',''completed'',''published''))');
  IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_exam_results_status')
    EXEC(N'ALTER TABLE dbo.exam_results WITH NOCHECK ADD CONSTRAINT CK_exam_results_status CHECK (status IN (''pass'',''fail'',''incomplete''))');
  IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_grading_scale_range')
    EXEC(N'ALTER TABLE dbo.grading_scale WITH NOCHECK ADD CONSTRAINT CK_grading_scale_range CHECK (min_percent >= 0 AND max_percent <= 100 AND min_percent <= max_percent)');

  -- 5) indexes -------------------------------------------------------------------
  IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_exam_marks_student' AND object_id = OBJECT_ID('dbo.exam_marks'))
    CREATE INDEX IX_exam_marks_student ON dbo.exam_marks (student_id) INCLUDE (exam_subject_id, marks_obtained, grade_obtained, status, updated_at);
  IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_exam_results_group_section' AND object_id = OBJECT_ID('dbo.exam_results'))
    CREATE INDEX IX_exam_results_group_section ON dbo.exam_results (exam_group_id, section_id) INCLUDE (student_id, status, percentage, grade, class_rank, school_rank, computed_at);
  IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_exam_results_student' AND object_id = OBJECT_ID('dbo.exam_results'))
    CREATE INDEX IX_exam_results_student ON dbo.exam_results (student_id) INCLUDE (exam_group_id, percentage, grade, status);

  -- one exam name per academic year (only when no duplicates exist today; the API also checks this)
  IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_exam_groups_name' AND object_id = OBJECT_ID('dbo.exam_groups'))
     AND NOT EXISTS (SELECT 1 FROM dbo.exam_groups WHERE deleted_at IS NULL GROUP BY school_id, academic_year_id, name HAVING COUNT(*) > 1)
    CREATE UNIQUE INDEX UQ_exam_groups_name ON dbo.exam_groups (school_id, academic_year_id, name) WHERE deleted_at IS NULL;

  COMMIT TRAN;
  PRINT 'exam_v2_migration: done';
END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0 ROLLBACK TRAN;
  THROW;
END CATCH;
