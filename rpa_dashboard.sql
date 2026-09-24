-- 1. إنشاء الداتابيز
CREATE DATABASE RPA_Dashboard;
GO

USE RPA_Dashboard;
GO

-- 2. إنشاء Login على مستوى السيرفر
CREATE LOGIN rpa_user WITH PASSWORD = 'Rpa@123456';
GO

-- 3. إنشاء User جوه الداتابيز وربطه بالـ Login
CREATE USER rpa_user FOR LOGIN rpa_user;
GO

-- 4. إعطاء صلاحيات كاملة على الداتابيز دي
ALTER ROLE db_owner ADD MEMBER rpa_user;
GO
==========================================================================


USE RPA_Dashboard;
GO

-- ==============================
-- جدول 1: بيانات تشغيل البروسيس (الأهم)
-- ==============================
CREATE TABLE ProcessRuns (
    RunID           INT IDENTITY(1,1) PRIMARY KEY,
    ProcessName     NVARCHAR(100) NOT NULL,          -- اسم البروسيس
    RequestID       NVARCHAR(50) NULL,              -- الريكوست الحالي
    Status          NVARCHAR(20) NOT NULL,           -- Running / Completed / Failed / Stopped
    StartTime       DATETIME NOT NULL,
    EndTime         DATETIME NULL,
    DurationMinutes DECIMAL(10,2) NULL,              -- المدة بالدقائق
    FailureReason   NVARCHAR(500) NULL,              -- سبب التوقف أو الفشل
    TransactionsCount INT DEFAULT 0,                 -- عدد المعاملات
    TimeSavedHours  DECIMAL(10,2) DEFAULT 0,         -- الوقت الموفر بالساعات
    CostSaved       DECIMAL(12,2) DEFAULT 0,         -- التكلفة الموفرة
    CreatedAt       DATETIME DEFAULT GETDATE()
);
GO

-- ==============================
-- جدول 2: إعدادات البروسيس (Expected Runs + Hourly Rate)
-- ==============================
CREATE TABLE ProcessConfig (
    ConfigID            INT IDENTITY(1,1) PRIMARY KEY,
    ProcessName         NVARCHAR(100) NOT NULL UNIQUE,
    ExpectedRunsPerDay  INT DEFAULT 0,               -- المفروض تشتغل كام مرة في اليوم
    HourlyRate          DECIMAL(10,2) DEFAULT 50,    -- سعر الساعة لحساب الكوست
    IsActive            BIT DEFAULT 1,
    Notes               NVARCHAR(500) NULL
);
GO

-- ==============================
-- بيانات تجريبية (Test Data)
-- ==============================

-- إعدادات البروسيس
INSERT INTO ProcessConfig (ProcessName, ExpectedRunsPerDay, HourlyRate, Notes)
VALUES 
('Invoice_Processing', 50, 45.00, 'معالجة الفواتير البنكية'),
('KYC_Check', 30, 55.00, 'فحص بيانات العملاء'),
('Loan_Disbursement', 20, 60.00, 'صرف القروض');

-- بيانات تشغيل (آخر يومين + اليوم)
INSERT INTO ProcessRuns 
(ProcessName, RequestID, Status, StartTime, EndTime, DurationMinutes, FailureReason, TransactionsCount, TimeSavedHours, CostSaved)
VALUES
-- اليوم
('Invoice_Processing', 'INV-20260923-001', 'Completed', '2026-09-23 08:15:00', '2026-09-23 08:22:30', 7.5,  NULL, 12, 1.8, 81.00),
('Invoice_Processing', 'INV-20260923-002', 'Completed', '2026-09-23 08:30:00', '2026-09-23 08:38:00', 8.0,  NULL, 15, 2.0, 90.00),
('Invoice_Processing', 'INV-20260923-003', 'Failed',    '2026-09-23 09:05:00', '2026-09-23 09:07:20', 2.3,  'Timeout while connecting to core banking', 0, 0, 0),
('Invoice_Processing', 'INV-20260923-004', 'Running',   '2026-09-23 10:10:00', NULL, NULL, NULL, 0, 0, 0),
('KYC_Check',          'KYC-88921',        'Completed', '2026-09-23 09:20:00', '2026-09-23 09:35:00', 15.0, NULL, 8, 2.5, 137.50),
('KYC_Check',          'KYC-88922',        'Stopped',   '2026-09-23 10:00:00', '2026-09-23 10:02:00', 2.0,  'Manual intervention required', 0, 0, 0),

-- أمس
('Invoice_Processing', 'INV-20260922-015', 'Completed', '2026-09-22 14:00:00', '2026-09-22 14:12:00', 12.0, NULL, 20, 3.0, 135.00),
('Invoice_Processing', 'INV-20260922-016', 'Failed',    '2026-09-22 15:30:00', '2026-09-22 15:32:00', 2.0,  'Invalid account number format', 0, 0, 0),
('Loan_Disbursement',  'LOAN-44501',       'Completed', '2026-09-22 11:00:00', '2026-09-22 11:25:00', 25.0, NULL, 5, 4.0, 240.00);
GO




====================================================================
====================================================================
USE RPA_Dashboard;
GO

-- إعدادات البروسيس
INSERT INTO ProcessConfig (ProcessName, ExpectedRunsPerDay, HourlyRate, Notes)
VALUES 
('credit_card_linkage', 80, 50.00, 'كريدت كارد');

-- بيانات تشغيل (آخر يومين + اليوم)
INSERT INTO ProcessRuns 
(ProcessName, RequestID, Status, StartTime, EndTime, DurationMinutes, FailureReason, TransactionsCount, TimeSavedHours, CostSaved)
VALUES
-- اليوم
('credit_card_linkage', 'INV-20260923-024', 'Completed', '2026-09-23 08:15:00', '2026-09-23 08:22:30', 7.5,  NULL, 12, 1.8, 81.00),
('credit_card_linkage', 'INV-20260923-025', 'Completed', '2026-09-23 08:30:00', '2026-09-23 08:38:00', 8.0,  NULL, 15, 2.0, 90.00),
('credit_card_linkage', 'INV-20260923-026', 'Failed',    '2026-09-23 09:05:00', '2026-09-23 09:07:20', 2.3,  'Timeout while connecting to database', 0, 0, 0),
('credit_card_linkage', 'INV-20260923-027', 'Running',   '2026-09-23 10:10:00', NULL, NULL, NULL, 0, 0, 0);
GO





=================================================

USE RPA_Dashboard;
GO

-- 1. إضافة عمود القسم (Department) وعمود المعاملات الناجحة والفاشلة لجدول الإعدادات أو التشغيل إذا لم يكن موجوداً
IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'ProcessConfig') AND name = 'Department')
BEGIN
    ALTER TABLE ProcessConfig ADD Department NVARCHAR(50) DEFAULT 'Operations';
END
GO

-- 2. تحديث بيانات الأقسام للتسجيل التجريبي
UPDATE ProcessConfig SET Department = 'Finance' WHERE ProcessName = 'Invoice_Processing';
UPDATE ProcessConfig SET Department = 'Operations' WHERE ProcessName = 'KYC_Check';
UPDATE ProcessConfig SET Department = 'IT' WHERE ProcessName = 'Loan_Disbursement';
GO

=============================================

USE RPA_Dashboard;
GO

-- إضافة أعمدة القسم واسم الروبوت
IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'ProcessConfig') AND name = 'Department')
BEGIN
    ALTER TABLE ProcessConfig ADD Department NVARCHAR(50) DEFAULT 'Operations';
    ALTER TABLE ProcessConfig ADD BotName NVARCHAR(50) DEFAULT 'Bot-01';
END
GO

-- تحديث البيانات الحالية لتوزيعها على الأقسام والروبوتات
UPDATE ProcessConfig SET Department = 'Finance', BotName = 'Bot-01' WHERE ProcessName = 'Invoice_Processing';
UPDATE ProcessConfig SET Department = 'Operations', BotName = 'Bot-02' WHERE ProcessName = 'KYC_Check';
UPDATE ProcessConfig SET Department = 'IT', BotName = 'Bot-03' WHERE ProcessName = 'Loan_Disbursement';
GO


================================

USE RPA_Dashboard;
GO

-- وقت المعاملة الواحدة يدوياً بالدقائق
ALTER TABLE ProcessConfig ADD EmpMinutesPerRequest DECIMAL(10,2) DEFAULT 15.0; 

-- تكلفة المعاملة الواحدة إذا قام بها الموظف (EGP)
ALTER TABLE ProcessConfig ADD EmpCostPerRequest DECIMAL(10,2) DEFAULT 10.0; 

-- تكلفة المعاملة الواحدة إذا قام بها البوت (EGP) (تُحسب كجزء من رخصة البوت أو السيرفر)
ALTER TABLE ProcessConfig ADD BotCostPerRequest DECIMAL(10,2) DEFAULT 0.5; 
GO

-- تحديث بيانات تجريبية لتجربة الحسابات
UPDATE ProcessConfig SET EmpMinutesPerRequest = 10, EmpCostPerRequest = 15, BotCostPerRequest = 1 WHERE ProcessName = 'Invoice_Processing';
UPDATE ProcessConfig SET EmpMinutesPerRequest = 20, EmpCostPerRequest = 25, BotCostPerRequest = 1.5 WHERE ProcessName = 'KYC_Check';
GO

=============================================================

