-- ==========================================================================
-- Control Room 4.x — Unicode (NVARCHAR) upgrade for Microsoft SQL Server
-- --------------------------------------------------------------------------
-- WHY: text columns were declared as VARCHAR.  Under a Latin collation a
--      VARCHAR column stores one byte per character, so Arabic process names,
--      audit details and user names were persisted as '????'.  This script
--      converts every text column of the application schema to NVARCHAR so
--      Arabic (and every other non-Latin script) round-trips intact.
--
-- HOW:  run once per database, inside a maintenance window, as a principal
--      with ALTER rights:
--          sqlcmd -S <server> -d <database> -E -i 005_unicode_nvarchar_upgrade.sql
--      The script is idempotent: each statement runs only when the column is
--      not already NVARCHAR.  Values already stored as '?' cannot be restored
--      — re-import those rows from the source platform after the upgrade.
--
-- NOTE: generated from app/db/tables.py — do not edit by hand.  Regenerate:
--          python -m app.db.unicode_upgrade --print > <this file>
-- ==========================================================================

SET NOCOUNT ON;
GO
-- AgentEnrollmentCodes
IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON c.user_type_id = t.user_type_id
           WHERE c.object_id = OBJECT_ID(N'[dbo].[AgentEnrollmentCodes]') AND c.name = N'MachineName'
             AND t.name <> N'nvarchar')
  ALTER TABLE [dbo].[AgentEnrollmentCodes] ALTER COLUMN [MachineName] NVARCHAR(100) NOT NULL;
IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON c.user_type_id = t.user_type_id
           WHERE c.object_id = OBJECT_ID(N'[dbo].[AgentEnrollmentCodes]') AND c.name = N'EnrollmentCode'
             AND t.name <> N'nvarchar')
  ALTER TABLE [dbo].[AgentEnrollmentCodes] ALTER COLUMN [EnrollmentCode] NVARCHAR(40) NOT NULL;
GO

-- Alerts
IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON c.user_type_id = t.user_type_id
           WHERE c.object_id = OBJECT_ID(N'[dbo].[Alerts]') AND c.name = N'RuleKey'
             AND t.name <> N'nvarchar')
  ALTER TABLE [dbo].[Alerts] ALTER COLUMN [RuleKey] NVARCHAR(80) NOT NULL;
IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON c.user_type_id = t.user_type_id
           WHERE c.object_id = OBJECT_ID(N'[dbo].[Alerts]') AND c.name = N'Severity'
             AND t.name <> N'nvarchar')
  ALTER TABLE [dbo].[Alerts] ALTER COLUMN [Severity] NVARCHAR(20) NOT NULL;
IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON c.user_type_id = t.user_type_id
           WHERE c.object_id = OBJECT_ID(N'[dbo].[Alerts]') AND c.name = N'Title'
             AND t.name <> N'nvarchar')
  ALTER TABLE [dbo].[Alerts] ALTER COLUMN [Title] NVARCHAR(300) NOT NULL;
IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON c.user_type_id = t.user_type_id
           WHERE c.object_id = OBJECT_ID(N'[dbo].[Alerts]') AND c.name = N'Detail'
             AND t.name <> N'nvarchar')
  ALTER TABLE [dbo].[Alerts] ALTER COLUMN [Detail] NVARCHAR(MAX) NULL;
IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON c.user_type_id = t.user_type_id
           WHERE c.object_id = OBJECT_ID(N'[dbo].[Alerts]') AND c.name = N'EntityType'
             AND t.name <> N'nvarchar')
  ALTER TABLE [dbo].[Alerts] ALTER COLUMN [EntityType] NVARCHAR(50) NULL;
IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON c.user_type_id = t.user_type_id
           WHERE c.object_id = OBJECT_ID(N'[dbo].[Alerts]') AND c.name = N'EntityID'
             AND t.name <> N'nvarchar')
  ALTER TABLE [dbo].[Alerts] ALTER COLUMN [EntityID] NVARCHAR(100) NULL;
IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON c.user_type_id = t.user_type_id
           WHERE c.object_id = OBJECT_ID(N'[dbo].[Alerts]') AND c.name = N'Status'
             AND t.name <> N'nvarchar')
  ALTER TABLE [dbo].[Alerts] ALTER COLUMN [Status] NVARCHAR(20) NOT NULL;
IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON c.user_type_id = t.user_type_id
           WHERE c.object_id = OBJECT_ID(N'[dbo].[Alerts]') AND c.name = N'DedupeKey'
             AND t.name <> N'nvarchar')
  ALTER TABLE [dbo].[Alerts] ALTER COLUMN [DedupeKey] NVARCHAR(200) NOT NULL;
IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON c.user_type_id = t.user_type_id
           WHERE c.object_id = OBJECT_ID(N'[dbo].[Alerts]') AND c.name = N'Fingerprint'
             AND t.name <> N'nvarchar')
  ALTER TABLE [dbo].[Alerts] ALTER COLUMN [Fingerprint] NVARCHAR(200) NULL;
GO

-- ApprovalRequests
IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON c.user_type_id = t.user_type_id
           WHERE c.object_id = OBJECT_ID(N'[dbo].[ApprovalRequests]') AND c.name = N'ProcessName'
             AND t.name <> N'nvarchar')
  ALTER TABLE [dbo].[ApprovalRequests] ALTER COLUMN [ProcessName] NVARCHAR(100) NOT NULL;
IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON c.user_type_id = t.user_type_id
           WHERE c.object_id = OBJECT_ID(N'[dbo].[ApprovalRequests]') AND c.name = N'TargetEnvironment'
             AND t.name <> N'nvarchar')
  ALTER TABLE [dbo].[ApprovalRequests] ALTER COLUMN [TargetEnvironment] NVARCHAR(40) NOT NULL;
IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON c.user_type_id = t.user_type_id
           WHERE c.object_id = OBJECT_ID(N'[dbo].[ApprovalRequests]') AND c.name = N'Status'
             AND t.name <> N'nvarchar')
  ALTER TABLE [dbo].[ApprovalRequests] ALTER COLUMN [Status] NVARCHAR(20) NOT NULL;
IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON c.user_type_id = t.user_type_id
           WHERE c.object_id = OBJECT_ID(N'[dbo].[ApprovalRequests]') AND c.name = N'Comment'
             AND t.name <> N'nvarchar')
  ALTER TABLE [dbo].[ApprovalRequests] ALTER COLUMN [Comment] NVARCHAR(500) NULL;
IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON c.user_type_id = t.user_type_id
           WHERE c.object_id = OBJECT_ID(N'[dbo].[ApprovalRequests]') AND c.name = N'RiskNotes'
             AND t.name <> N'nvarchar')
  ALTER TABLE [dbo].[ApprovalRequests] ALTER COLUMN [RiskNotes] NVARCHAR(MAX) NULL;
GO

-- AuditLogs
IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON c.user_type_id = t.user_type_id
           WHERE c.object_id = OBJECT_ID(N'[dbo].[AuditLogs]') AND c.name = N'ActionType'
             AND t.name <> N'nvarchar')
  ALTER TABLE [dbo].[AuditLogs] ALTER COLUMN [ActionType] NVARCHAR(60) NOT NULL;
IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON c.user_type_id = t.user_type_id
           WHERE c.object_id = OBJECT_ID(N'[dbo].[AuditLogs]') AND c.name = N'ProcessName'
             AND t.name <> N'nvarchar')
  ALTER TABLE [dbo].[AuditLogs] ALTER COLUMN [ProcessName] NVARCHAR(100) NULL;
IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON c.user_type_id = t.user_type_id
           WHERE c.object_id = OBJECT_ID(N'[dbo].[AuditLogs]') AND c.name = N'EntityType'
             AND t.name <> N'nvarchar')
  ALTER TABLE [dbo].[AuditLogs] ALTER COLUMN [EntityType] NVARCHAR(50) NULL;
IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON c.user_type_id = t.user_type_id
           WHERE c.object_id = OBJECT_ID(N'[dbo].[AuditLogs]') AND c.name = N'EntityID'
             AND t.name <> N'nvarchar')
  ALTER TABLE [dbo].[AuditLogs] ALTER COLUMN [EntityID] NVARCHAR(80) NULL;
IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON c.user_type_id = t.user_type_id
           WHERE c.object_id = OBJECT_ID(N'[dbo].[AuditLogs]') AND c.name = N'OldValues'
             AND t.name <> N'nvarchar')
  ALTER TABLE [dbo].[AuditLogs] ALTER COLUMN [OldValues] NVARCHAR(MAX) NULL;
IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON c.user_type_id = t.user_type_id
           WHERE c.object_id = OBJECT_ID(N'[dbo].[AuditLogs]') AND c.name = N'NewValues'
             AND t.name <> N'nvarchar')
  ALTER TABLE [dbo].[AuditLogs] ALTER COLUMN [NewValues] NVARCHAR(MAX) NULL;
IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON c.user_type_id = t.user_type_id
           WHERE c.object_id = OBJECT_ID(N'[dbo].[AuditLogs]') AND c.name = N'IPAddress'
             AND t.name <> N'nvarchar')
  ALTER TABLE [dbo].[AuditLogs] ALTER COLUMN [IPAddress] NVARCHAR(64) NULL;
IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON c.user_type_id = t.user_type_id
           WHERE c.object_id = OBJECT_ID(N'[dbo].[AuditLogs]') AND c.name = N'UserAgent'
             AND t.name <> N'nvarchar')
  ALTER TABLE [dbo].[AuditLogs] ALTER COLUMN [UserAgent] NVARCHAR(400) NULL;
IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON c.user_type_id = t.user_type_id
           WHERE c.object_id = OBJECT_ID(N'[dbo].[AuditLogs]') AND c.name = N'CorrelationID'
             AND t.name <> N'nvarchar')
  ALTER TABLE [dbo].[AuditLogs] ALTER COLUMN [CorrelationID] NVARCHAR(64) NULL;
GO

-- BotCommands
IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON c.user_type_id = t.user_type_id
           WHERE c.object_id = OBJECT_ID(N'[dbo].[BotCommands]') AND c.name = N'MachineName'
             AND t.name <> N'nvarchar')
  ALTER TABLE [dbo].[BotCommands] ALTER COLUMN [MachineName] NVARCHAR(100) NOT NULL;
IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON c.user_type_id = t.user_type_id
           WHERE c.object_id = OBJECT_ID(N'[dbo].[BotCommands]') AND c.name = N'Command'
             AND t.name <> N'nvarchar')
  ALTER TABLE [dbo].[BotCommands] ALTER COLUMN [Command] NVARCHAR(200) NOT NULL;
IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON c.user_type_id = t.user_type_id
           WHERE c.object_id = OBJECT_ID(N'[dbo].[BotCommands]') AND c.name = N'PayloadJson'
             AND t.name <> N'nvarchar')
  ALTER TABLE [dbo].[BotCommands] ALTER COLUMN [PayloadJson] NVARCHAR(MAX) NULL;
IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON c.user_type_id = t.user_type_id
           WHERE c.object_id = OBJECT_ID(N'[dbo].[BotCommands]') AND c.name = N'Status'
             AND t.name <> N'nvarchar')
  ALTER TABLE [dbo].[BotCommands] ALTER COLUMN [Status] NVARCHAR(20) NOT NULL;
IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON c.user_type_id = t.user_type_id
           WHERE c.object_id = OBJECT_ID(N'[dbo].[BotCommands]') AND c.name = N'Result'
             AND t.name <> N'nvarchar')
  ALTER TABLE [dbo].[BotCommands] ALTER COLUMN [Result] NVARCHAR(500) NULL;
IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON c.user_type_id = t.user_type_id
           WHERE c.object_id = OBJECT_ID(N'[dbo].[BotCommands]') AND c.name = N'Signature'
             AND t.name <> N'nvarchar')
  ALTER TABLE [dbo].[BotCommands] ALTER COLUMN [Signature] NVARCHAR(128) NULL;
GO

-- BotInfrastructure
IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON c.user_type_id = t.user_type_id
           WHERE c.object_id = OBJECT_ID(N'[dbo].[BotInfrastructure]') AND c.name = N'MachineName'
             AND t.name <> N'nvarchar')
  ALTER TABLE [dbo].[BotInfrastructure] ALTER COLUMN [MachineName] NVARCHAR(100) NOT NULL;
IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON c.user_type_id = t.user_type_id
           WHERE c.object_id = OBJECT_ID(N'[dbo].[BotInfrastructure]') AND c.name = N'AssignedProcess'
             AND t.name <> N'nvarchar')
  ALTER TABLE [dbo].[BotInfrastructure] ALTER COLUMN [AssignedProcess] NVARCHAR(100) NULL;
IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON c.user_type_id = t.user_type_id
           WHERE c.object_id = OBJECT_ID(N'[dbo].[BotInfrastructure]') AND c.name = N'Status'
             AND t.name <> N'nvarchar')
  ALTER TABLE [dbo].[BotInfrastructure] ALTER COLUMN [Status] NVARCHAR(20) NOT NULL;
IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON c.user_type_id = t.user_type_id
           WHERE c.object_id = OBJECT_ID(N'[dbo].[BotInfrastructure]') AND c.name = N'RunnerType'
             AND t.name <> N'nvarchar')
  ALTER TABLE [dbo].[BotInfrastructure] ALTER COLUMN [RunnerType] NVARCHAR(20) NOT NULL;
IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON c.user_type_id = t.user_type_id
           WHERE c.object_id = OBJECT_ID(N'[dbo].[BotInfrastructure]') AND c.name = N'Platform'
             AND t.name <> N'nvarchar')
  ALTER TABLE [dbo].[BotInfrastructure] ALTER COLUMN [Platform] NVARCHAR(40) NOT NULL;
IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON c.user_type_id = t.user_type_id
           WHERE c.object_id = OBJECT_ID(N'[dbo].[BotInfrastructure]') AND c.name = N'AgentToken'
             AND t.name <> N'nvarchar')
  ALTER TABLE [dbo].[BotInfrastructure] ALTER COLUMN [AgentToken] NVARCHAR(200) NULL;
IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON c.user_type_id = t.user_type_id
           WHERE c.object_id = OBJECT_ID(N'[dbo].[BotInfrastructure]') AND c.name = N'LastIP'
             AND t.name <> N'nvarchar')
  ALTER TABLE [dbo].[BotInfrastructure] ALTER COLUMN [LastIP] NVARCHAR(64) NULL;
IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON c.user_type_id = t.user_type_id
           WHERE c.object_id = OBJECT_ID(N'[dbo].[BotInfrastructure]') AND c.name = N'OSName'
             AND t.name <> N'nvarchar')
  ALTER TABLE [dbo].[BotInfrastructure] ALTER COLUMN [OSName] NVARCHAR(64) NULL;
IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON c.user_type_id = t.user_type_id
           WHERE c.object_id = OBJECT_ID(N'[dbo].[BotInfrastructure]') AND c.name = N'AgentVersion'
             AND t.name <> N'nvarchar')
  ALTER TABLE [dbo].[BotInfrastructure] ALTER COLUMN [AgentVersion] NVARCHAR(40) NULL;
GO

-- BotVault
IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON c.user_type_id = t.user_type_id
           WHERE c.object_id = OBJECT_ID(N'[dbo].[BotVault]') AND c.name = N'CredentialName'
             AND t.name <> N'nvarchar')
  ALTER TABLE [dbo].[BotVault] ALTER COLUMN [CredentialName] NVARCHAR(100) NOT NULL;
IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON c.user_type_id = t.user_type_id
           WHERE c.object_id = OBJECT_ID(N'[dbo].[BotVault]') AND c.name = N'Environment'
             AND t.name <> N'nvarchar')
  ALTER TABLE [dbo].[BotVault] ALTER COLUMN [Environment] NVARCHAR(20) NOT NULL;
IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON c.user_type_id = t.user_type_id
           WHERE c.object_id = OBJECT_ID(N'[dbo].[BotVault]') AND c.name = N'EncryptedValue'
             AND t.name <> N'nvarchar')
  ALTER TABLE [dbo].[BotVault] ALTER COLUMN [EncryptedValue] NVARCHAR(MAX) NOT NULL;
IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON c.user_type_id = t.user_type_id
           WHERE c.object_id = OBJECT_ID(N'[dbo].[BotVault]') AND c.name = N'KeyVersion'
             AND t.name <> N'nvarchar')
  ALTER TABLE [dbo].[BotVault] ALTER COLUMN [KeyVersion] NVARCHAR(20) NOT NULL;
GO

-- BotVersions
IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON c.user_type_id = t.user_type_id
           WHERE c.object_id = OBJECT_ID(N'[dbo].[BotVersions]') AND c.name = N'ProcessName'
             AND t.name <> N'nvarchar')
  ALTER TABLE [dbo].[BotVersions] ALTER COLUMN [ProcessName] NVARCHAR(100) NOT NULL;
IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON c.user_type_id = t.user_type_id
           WHERE c.object_id = OBJECT_ID(N'[dbo].[BotVersions]') AND c.name = N'VersionTag'
             AND t.name <> N'nvarchar')
  ALTER TABLE [dbo].[BotVersions] ALTER COLUMN [VersionTag] NVARCHAR(40) NOT NULL;
IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON c.user_type_id = t.user_type_id
           WHERE c.object_id = OBJECT_ID(N'[dbo].[BotVersions]') AND c.name = N'CurrentStatus'
             AND t.name <> N'nvarchar')
  ALTER TABLE [dbo].[BotVersions] ALTER COLUMN [CurrentStatus] NVARCHAR(40) NOT NULL;
IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON c.user_type_id = t.user_type_id
           WHERE c.object_id = OBJECT_ID(N'[dbo].[BotVersions]') AND c.name = N'TargetMachineName'
             AND t.name <> N'nvarchar')
  ALTER TABLE [dbo].[BotVersions] ALTER COLUMN [TargetMachineName] NVARCHAR(100) NULL;
IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON c.user_type_id = t.user_type_id
           WHERE c.object_id = OBJECT_ID(N'[dbo].[BotVersions]') AND c.name = N'Notes'
             AND t.name <> N'nvarchar')
  ALTER TABLE [dbo].[BotVersions] ALTER COLUMN [Notes] NVARCHAR(MAX) NULL;
IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON c.user_type_id = t.user_type_id
           WHERE c.object_id = OBJECT_ID(N'[dbo].[BotVersions]') AND c.name = N'ArtifactUrl'
             AND t.name <> N'nvarchar')
  ALTER TABLE [dbo].[BotVersions] ALTER COLUMN [ArtifactUrl] NVARCHAR(500) NULL;
GO

-- NotificationLog
IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON c.user_type_id = t.user_type_id
           WHERE c.object_id = OBJECT_ID(N'[dbo].[NotificationLog]') AND c.name = N'Channel'
             AND t.name <> N'nvarchar')
  ALTER TABLE [dbo].[NotificationLog] ALTER COLUMN [Channel] NVARCHAR(30) NOT NULL;
IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON c.user_type_id = t.user_type_id
           WHERE c.object_id = OBJECT_ID(N'[dbo].[NotificationLog]') AND c.name = N'Target'
             AND t.name <> N'nvarchar')
  ALTER TABLE [dbo].[NotificationLog] ALTER COLUMN [Target] NVARCHAR(300) NULL;
IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON c.user_type_id = t.user_type_id
           WHERE c.object_id = OBJECT_ID(N'[dbo].[NotificationLog]') AND c.name = N'Subject'
             AND t.name <> N'nvarchar')
  ALTER TABLE [dbo].[NotificationLog] ALTER COLUMN [Subject] NVARCHAR(300) NOT NULL;
IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON c.user_type_id = t.user_type_id
           WHERE c.object_id = OBJECT_ID(N'[dbo].[NotificationLog]') AND c.name = N'Body'
             AND t.name <> N'nvarchar')
  ALTER TABLE [dbo].[NotificationLog] ALTER COLUMN [Body] NVARCHAR(MAX) NULL;
IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON c.user_type_id = t.user_type_id
           WHERE c.object_id = OBJECT_ID(N'[dbo].[NotificationLog]') AND c.name = N'Status'
             AND t.name <> N'nvarchar')
  ALTER TABLE [dbo].[NotificationLog] ALTER COLUMN [Status] NVARCHAR(20) NOT NULL;
IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON c.user_type_id = t.user_type_id
           WHERE c.object_id = OBJECT_ID(N'[dbo].[NotificationLog]') AND c.name = N'Error'
             AND t.name <> N'nvarchar')
  ALTER TABLE [dbo].[NotificationLog] ALTER COLUMN [Error] NVARCHAR(500) NULL;
IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON c.user_type_id = t.user_type_id
           WHERE c.object_id = OBJECT_ID(N'[dbo].[NotificationLog]') AND c.name = N'RelatedType'
             AND t.name <> N'nvarchar')
  ALTER TABLE [dbo].[NotificationLog] ALTER COLUMN [RelatedType] NVARCHAR(40) NULL;
IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON c.user_type_id = t.user_type_id
           WHERE c.object_id = OBJECT_ID(N'[dbo].[NotificationLog]') AND c.name = N'RelatedID'
             AND t.name <> N'nvarchar')
  ALTER TABLE [dbo].[NotificationLog] ALTER COLUMN [RelatedID] NVARCHAR(80) NULL;
IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON c.user_type_id = t.user_type_id
           WHERE c.object_id = OBJECT_ID(N'[dbo].[NotificationLog]') AND c.name = N'DedupeKey'
             AND t.name <> N'nvarchar')
  ALTER TABLE [dbo].[NotificationLog] ALTER COLUMN [DedupeKey] NVARCHAR(160) NULL;
GO

-- Organization
IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON c.user_type_id = t.user_type_id
           WHERE c.object_id = OBJECT_ID(N'[dbo].[Organization]') AND c.name = N'Name'
             AND t.name <> N'nvarchar')
  ALTER TABLE [dbo].[Organization] ALTER COLUMN [Name] NVARCHAR(200) NOT NULL;
IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON c.user_type_id = t.user_type_id
           WHERE c.object_id = OBJECT_ID(N'[dbo].[Organization]') AND c.name = N'CompanyName'
             AND t.name <> N'nvarchar')
  ALTER TABLE [dbo].[Organization] ALTER COLUMN [CompanyName] NVARCHAR(200) NULL;
IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON c.user_type_id = t.user_type_id
           WHERE c.object_id = OBJECT_ID(N'[dbo].[Organization]') AND c.name = N'BrandPrimaryColor'
             AND t.name <> N'nvarchar')
  ALTER TABLE [dbo].[Organization] ALTER COLUMN [BrandPrimaryColor] NVARCHAR(20) NOT NULL;
IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON c.user_type_id = t.user_type_id
           WHERE c.object_id = OBJECT_ID(N'[dbo].[Organization]') AND c.name = N'BrandAccentColor'
             AND t.name <> N'nvarchar')
  ALTER TABLE [dbo].[Organization] ALTER COLUMN [BrandAccentColor] NVARCHAR(20) NOT NULL;
IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON c.user_type_id = t.user_type_id
           WHERE c.object_id = OBJECT_ID(N'[dbo].[Organization]') AND c.name = N'LogoUrl'
             AND t.name <> N'nvarchar')
  ALTER TABLE [dbo].[Organization] ALTER COLUMN [LogoUrl] NVARCHAR(500) NULL;
IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON c.user_type_id = t.user_type_id
           WHERE c.object_id = OBJECT_ID(N'[dbo].[Organization]') AND c.name = N'Locale'
             AND t.name <> N'nvarchar')
  ALTER TABLE [dbo].[Organization] ALTER COLUMN [Locale] NVARCHAR(10) NOT NULL;
IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON c.user_type_id = t.user_type_id
           WHERE c.object_id = OBJECT_ID(N'[dbo].[Organization]') AND c.name = N'TimeZone'
             AND t.name <> N'nvarchar')
  ALTER TABLE [dbo].[Organization] ALTER COLUMN [TimeZone] NVARCHAR(64) NOT NULL;
IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON c.user_type_id = t.user_type_id
           WHERE c.object_id = OBJECT_ID(N'[dbo].[Organization]') AND c.name = N'PlatformProvider'
             AND t.name <> N'nvarchar')
  ALTER TABLE [dbo].[Organization] ALTER COLUMN [PlatformProvider] NVARCHAR(40) NOT NULL;
IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON c.user_type_id = t.user_type_id
           WHERE c.object_id = OBJECT_ID(N'[dbo].[Organization]') AND c.name = N'PlatformConfigJson'
             AND t.name <> N'nvarchar')
  ALTER TABLE [dbo].[Organization] ALTER COLUMN [PlatformConfigJson] NVARCHAR(MAX) NULL;
GO

-- PasswordHistory
IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON c.user_type_id = t.user_type_id
           WHERE c.object_id = OBJECT_ID(N'[dbo].[PasswordHistory]') AND c.name = N'PasswordHash'
             AND t.name <> N'nvarchar')
  ALTER TABLE [dbo].[PasswordHistory] ALTER COLUMN [PasswordHash] NVARCHAR(255) NOT NULL;
GO

-- PlatformSyncLog
IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON c.user_type_id = t.user_type_id
           WHERE c.object_id = OBJECT_ID(N'[dbo].[PlatformSyncLog]') AND c.name = N'Provider'
             AND t.name <> N'nvarchar')
  ALTER TABLE [dbo].[PlatformSyncLog] ALTER COLUMN [Provider] NVARCHAR(40) NOT NULL;
IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON c.user_type_id = t.user_type_id
           WHERE c.object_id = OBJECT_ID(N'[dbo].[PlatformSyncLog]') AND c.name = N'Operation'
             AND t.name <> N'nvarchar')
  ALTER TABLE [dbo].[PlatformSyncLog] ALTER COLUMN [Operation] NVARCHAR(60) NOT NULL;
IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON c.user_type_id = t.user_type_id
           WHERE c.object_id = OBJECT_ID(N'[dbo].[PlatformSyncLog]') AND c.name = N'Status'
             AND t.name <> N'nvarchar')
  ALTER TABLE [dbo].[PlatformSyncLog] ALTER COLUMN [Status] NVARCHAR(20) NOT NULL;
IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON c.user_type_id = t.user_type_id
           WHERE c.object_id = OBJECT_ID(N'[dbo].[PlatformSyncLog]') AND c.name = N'Error'
             AND t.name <> N'nvarchar')
  ALTER TABLE [dbo].[PlatformSyncLog] ALTER COLUMN [Error] NVARCHAR(500) NULL;
GO

-- ProcessConfig
IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON c.user_type_id = t.user_type_id
           WHERE c.object_id = OBJECT_ID(N'[dbo].[ProcessConfig]') AND c.name = N'ProcessName'
             AND t.name <> N'nvarchar')
  ALTER TABLE [dbo].[ProcessConfig] ALTER COLUMN [ProcessName] NVARCHAR(100) NOT NULL;
IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON c.user_type_id = t.user_type_id
           WHERE c.object_id = OBJECT_ID(N'[dbo].[ProcessConfig]') AND c.name = N'Department'
             AND t.name <> N'nvarchar')
  ALTER TABLE [dbo].[ProcessConfig] ALTER COLUMN [Department] NVARCHAR(50) NOT NULL;
IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON c.user_type_id = t.user_type_id
           WHERE c.object_id = OBJECT_ID(N'[dbo].[ProcessConfig]') AND c.name = N'BotName'
             AND t.name <> N'nvarchar')
  ALTER TABLE [dbo].[ProcessConfig] ALTER COLUMN [BotName] NVARCHAR(100) NULL;
IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON c.user_type_id = t.user_type_id
           WHERE c.object_id = OBJECT_ID(N'[dbo].[ProcessConfig]') AND c.name = N'Provider'
             AND t.name <> N'nvarchar')
  ALTER TABLE [dbo].[ProcessConfig] ALTER COLUMN [Provider] NVARCHAR(40) NOT NULL;
IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON c.user_type_id = t.user_type_id
           WHERE c.object_id = OBJECT_ID(N'[dbo].[ProcessConfig]') AND c.name = N'PlatformProcessKey'
             AND t.name <> N'nvarchar')
  ALTER TABLE [dbo].[ProcessConfig] ALTER COLUMN [PlatformProcessKey] NVARCHAR(200) NULL;
IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON c.user_type_id = t.user_type_id
           WHERE c.object_id = OBJECT_ID(N'[dbo].[ProcessConfig]') AND c.name = N'Criticality'
             AND t.name <> N'nvarchar')
  ALTER TABLE [dbo].[ProcessConfig] ALTER COLUMN [Criticality] NVARCHAR(20) NOT NULL;
IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON c.user_type_id = t.user_type_id
           WHERE c.object_id = OBJECT_ID(N'[dbo].[ProcessConfig]') AND c.name = N'Notes'
             AND t.name <> N'nvarchar')
  ALTER TABLE [dbo].[ProcessConfig] ALTER COLUMN [Notes] NVARCHAR(500) NULL;
GO

-- ProcessQueues
IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON c.user_type_id = t.user_type_id
           WHERE c.object_id = OBJECT_ID(N'[dbo].[ProcessQueues]') AND c.name = N'ProcessName'
             AND t.name <> N'nvarchar')
  ALTER TABLE [dbo].[ProcessQueues] ALTER COLUMN [ProcessName] NVARCHAR(100) NOT NULL;
GO

-- ProcessRuns
IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON c.user_type_id = t.user_type_id
           WHERE c.object_id = OBJECT_ID(N'[dbo].[ProcessRuns]') AND c.name = N'ProcessName'
             AND t.name <> N'nvarchar')
  ALTER TABLE [dbo].[ProcessRuns] ALTER COLUMN [ProcessName] NVARCHAR(100) NOT NULL;
IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON c.user_type_id = t.user_type_id
           WHERE c.object_id = OBJECT_ID(N'[dbo].[ProcessRuns]') AND c.name = N'RequestID'
             AND t.name <> N'nvarchar')
  ALTER TABLE [dbo].[ProcessRuns] ALTER COLUMN [RequestID] NVARCHAR(100) NULL;
IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON c.user_type_id = t.user_type_id
           WHERE c.object_id = OBJECT_ID(N'[dbo].[ProcessRuns]') AND c.name = N'Status'
             AND t.name <> N'nvarchar')
  ALTER TABLE [dbo].[ProcessRuns] ALTER COLUMN [Status] NVARCHAR(20) NOT NULL;
IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON c.user_type_id = t.user_type_id
           WHERE c.object_id = OBJECT_ID(N'[dbo].[ProcessRuns]') AND c.name = N'FailureReason'
             AND t.name <> N'nvarchar')
  ALTER TABLE [dbo].[ProcessRuns] ALTER COLUMN [FailureReason] NVARCHAR(500) NULL;
IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON c.user_type_id = t.user_type_id
           WHERE c.object_id = OBJECT_ID(N'[dbo].[ProcessRuns]') AND c.name = N'IdempotencyKey'
             AND t.name <> N'nvarchar')
  ALTER TABLE [dbo].[ProcessRuns] ALTER COLUMN [IdempotencyKey] NVARCHAR(120) NULL;
IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON c.user_type_id = t.user_type_id
           WHERE c.object_id = OBJECT_ID(N'[dbo].[ProcessRuns]') AND c.name = N'MachineName'
             AND t.name <> N'nvarchar')
  ALTER TABLE [dbo].[ProcessRuns] ALTER COLUMN [MachineName] NVARCHAR(100) NULL;
IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON c.user_type_id = t.user_type_id
           WHERE c.object_id = OBJECT_ID(N'[dbo].[ProcessRuns]') AND c.name = N'RobotName'
             AND t.name <> N'nvarchar')
  ALTER TABLE [dbo].[ProcessRuns] ALTER COLUMN [RobotName] NVARCHAR(100) NULL;
IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON c.user_type_id = t.user_type_id
           WHERE c.object_id = OBJECT_ID(N'[dbo].[ProcessRuns]') AND c.name = N'Provider'
             AND t.name <> N'nvarchar')
  ALTER TABLE [dbo].[ProcessRuns] ALTER COLUMN [Provider] NVARCHAR(40) NULL;
IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON c.user_type_id = t.user_type_id
           WHERE c.object_id = OBJECT_ID(N'[dbo].[ProcessRuns]') AND c.name = N'ProviderRunId'
             AND t.name <> N'nvarchar')
  ALTER TABLE [dbo].[ProcessRuns] ALTER COLUMN [ProviderRunId] NVARCHAR(200) NULL;
IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON c.user_type_id = t.user_type_id
           WHERE c.object_id = OBJECT_ID(N'[dbo].[ProcessRuns]') AND c.name = N'ExitCode'
             AND t.name <> N'nvarchar')
  ALTER TABLE [dbo].[ProcessRuns] ALTER COLUMN [ExitCode] NVARCHAR(40) NULL;
IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON c.user_type_id = t.user_type_id
           WHERE c.object_id = OBJECT_ID(N'[dbo].[ProcessRuns]') AND c.name = N'Trigger'
             AND t.name <> N'nvarchar')
  ALTER TABLE [dbo].[ProcessRuns] ALTER COLUMN [Trigger] NVARCHAR(40) NULL;
IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON c.user_type_id = t.user_type_id
           WHERE c.object_id = OBJECT_ID(N'[dbo].[ProcessRuns]') AND c.name = N'TriggeredBy'
             AND t.name <> N'nvarchar')
  ALTER TABLE [dbo].[ProcessRuns] ALTER COLUMN [TriggeredBy] NVARCHAR(100) NULL;
IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON c.user_type_id = t.user_type_id
           WHERE c.object_id = OBJECT_ID(N'[dbo].[ProcessRuns]') AND c.name = N'TriggerReason'
             AND t.name <> N'nvarchar')
  ALTER TABLE [dbo].[ProcessRuns] ALTER COLUMN [TriggerReason] NVARCHAR(300) NULL;
GO

-- PromotionAuditLog
IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON c.user_type_id = t.user_type_id
           WHERE c.object_id = OBJECT_ID(N'[dbo].[PromotionAuditLog]') AND c.name = N'PreviousStatus'
             AND t.name <> N'nvarchar')
  ALTER TABLE [dbo].[PromotionAuditLog] ALTER COLUMN [PreviousStatus] NVARCHAR(40) NOT NULL;
IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON c.user_type_id = t.user_type_id
           WHERE c.object_id = OBJECT_ID(N'[dbo].[PromotionAuditLog]') AND c.name = N'NewStatus'
             AND t.name <> N'nvarchar')
  ALTER TABLE [dbo].[PromotionAuditLog] ALTER COLUMN [NewStatus] NVARCHAR(40) NOT NULL;
IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON c.user_type_id = t.user_type_id
           WHERE c.object_id = OBJECT_ID(N'[dbo].[PromotionAuditLog]') AND c.name = N'IPAddress'
             AND t.name <> N'nvarchar')
  ALTER TABLE [dbo].[PromotionAuditLog] ALTER COLUMN [IPAddress] NVARCHAR(64) NULL;
IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON c.user_type_id = t.user_type_id
           WHERE c.object_id = OBJECT_ID(N'[dbo].[PromotionAuditLog]') AND c.name = N'Comment'
             AND t.name <> N'nvarchar')
  ALTER TABLE [dbo].[PromotionAuditLog] ALTER COLUMN [Comment] NVARCHAR(500) NULL;
GO

-- QueueSnapshots
IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON c.user_type_id = t.user_type_id
           WHERE c.object_id = OBJECT_ID(N'[dbo].[QueueSnapshots]') AND c.name = N'ProcessName'
             AND t.name <> N'nvarchar')
  ALTER TABLE [dbo].[QueueSnapshots] ALTER COLUMN [ProcessName] NVARCHAR(100) NOT NULL;
GO

-- Recommendations
IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON c.user_type_id = t.user_type_id
           WHERE c.object_id = OBJECT_ID(N'[dbo].[Recommendations]') AND c.name = N'Kind'
             AND t.name <> N'nvarchar')
  ALTER TABLE [dbo].[Recommendations] ALTER COLUMN [Kind] NVARCHAR(60) NOT NULL;
IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON c.user_type_id = t.user_type_id
           WHERE c.object_id = OBJECT_ID(N'[dbo].[Recommendations]') AND c.name = N'Severity'
             AND t.name <> N'nvarchar')
  ALTER TABLE [dbo].[Recommendations] ALTER COLUMN [Severity] NVARCHAR(20) NOT NULL;
IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON c.user_type_id = t.user_type_id
           WHERE c.object_id = OBJECT_ID(N'[dbo].[Recommendations]') AND c.name = N'ProcessName'
             AND t.name <> N'nvarchar')
  ALTER TABLE [dbo].[Recommendations] ALTER COLUMN [ProcessName] NVARCHAR(100) NULL;
IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON c.user_type_id = t.user_type_id
           WHERE c.object_id = OBJECT_ID(N'[dbo].[Recommendations]') AND c.name = N'Department'
             AND t.name <> N'nvarchar')
  ALTER TABLE [dbo].[Recommendations] ALTER COLUMN [Department] NVARCHAR(50) NULL;
IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON c.user_type_id = t.user_type_id
           WHERE c.object_id = OBJECT_ID(N'[dbo].[Recommendations]') AND c.name = N'Title'
             AND t.name <> N'nvarchar')
  ALTER TABLE [dbo].[Recommendations] ALTER COLUMN [Title] NVARCHAR(300) NOT NULL;
IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON c.user_type_id = t.user_type_id
           WHERE c.object_id = OBJECT_ID(N'[dbo].[Recommendations]') AND c.name = N'Detail'
             AND t.name <> N'nvarchar')
  ALTER TABLE [dbo].[Recommendations] ALTER COLUMN [Detail] NVARCHAR(MAX) NULL;
IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON c.user_type_id = t.user_type_id
           WHERE c.object_id = OBJECT_ID(N'[dbo].[Recommendations]') AND c.name = N'MetricsJson'
             AND t.name <> N'nvarchar')
  ALTER TABLE [dbo].[Recommendations] ALTER COLUMN [MetricsJson] NVARCHAR(MAX) NULL;
IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON c.user_type_id = t.user_type_id
           WHERE c.object_id = OBJECT_ID(N'[dbo].[Recommendations]') AND c.name = N'SuggestedAction'
             AND t.name <> N'nvarchar')
  ALTER TABLE [dbo].[Recommendations] ALTER COLUMN [SuggestedAction] NVARCHAR(200) NULL;
IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON c.user_type_id = t.user_type_id
           WHERE c.object_id = OBJECT_ID(N'[dbo].[Recommendations]') AND c.name = N'ActionPayloadJson'
             AND t.name <> N'nvarchar')
  ALTER TABLE [dbo].[Recommendations] ALTER COLUMN [ActionPayloadJson] NVARCHAR(MAX) NULL;
IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON c.user_type_id = t.user_type_id
           WHERE c.object_id = OBJECT_ID(N'[dbo].[Recommendations]') AND c.name = N'Status'
             AND t.name <> N'nvarchar')
  ALTER TABLE [dbo].[Recommendations] ALTER COLUMN [Status] NVARCHAR(20) NOT NULL;
IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON c.user_type_id = t.user_type_id
           WHERE c.object_id = OBJECT_ID(N'[dbo].[Recommendations]') AND c.name = N'Fingerprint'
             AND t.name <> N'nvarchar')
  ALTER TABLE [dbo].[Recommendations] ALTER COLUMN [Fingerprint] NVARCHAR(120) NULL;
GO

-- RefreshTokens
IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON c.user_type_id = t.user_type_id
           WHERE c.object_id = OBJECT_ID(N'[dbo].[RefreshTokens]') AND c.name = N'TokenHash'
             AND t.name <> N'nvarchar')
  ALTER TABLE [dbo].[RefreshTokens] ALTER COLUMN [TokenHash] NVARCHAR(128) NOT NULL;
IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON c.user_type_id = t.user_type_id
           WHERE c.object_id = OBJECT_ID(N'[dbo].[RefreshTokens]') AND c.name = N'RevokedReason'
             AND t.name <> N'nvarchar')
  ALTER TABLE [dbo].[RefreshTokens] ALTER COLUMN [RevokedReason] NVARCHAR(200) NULL;
IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON c.user_type_id = t.user_type_id
           WHERE c.object_id = OBJECT_ID(N'[dbo].[RefreshTokens]') AND c.name = N'IPAddress'
             AND t.name <> N'nvarchar')
  ALTER TABLE [dbo].[RefreshTokens] ALTER COLUMN [IPAddress] NVARCHAR(64) NULL;
IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON c.user_type_id = t.user_type_id
           WHERE c.object_id = OBJECT_ID(N'[dbo].[RefreshTokens]') AND c.name = N'UserAgent'
             AND t.name <> N'nvarchar')
  ALTER TABLE [dbo].[RefreshTokens] ALTER COLUMN [UserAgent] NVARCHAR(400) NULL;
GO

-- RolePermissions
IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON c.user_type_id = t.user_type_id
           WHERE c.object_id = OBJECT_ID(N'[dbo].[RolePermissions]') AND c.name = N'Role'
             AND t.name <> N'nvarchar')
  ALTER TABLE [dbo].[RolePermissions] ALTER COLUMN [Role] NVARCHAR(50) NOT NULL;
IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON c.user_type_id = t.user_type_id
           WHERE c.object_id = OBJECT_ID(N'[dbo].[RolePermissions]') AND c.name = N'Permission'
             AND t.name <> N'nvarchar')
  ALTER TABLE [dbo].[RolePermissions] ALTER COLUMN [Permission] NVARCHAR(100) NOT NULL;
GO

-- SchemaVersions
IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON c.user_type_id = t.user_type_id
           WHERE c.object_id = OBJECT_ID(N'[dbo].[SchemaVersions]') AND c.name = N'Description'
             AND t.name <> N'nvarchar')
  ALTER TABLE [dbo].[SchemaVersions] ALTER COLUMN [Description] NVARCHAR(300) NULL;
GO

-- SystemUsers
IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON c.user_type_id = t.user_type_id
           WHERE c.object_id = OBJECT_ID(N'[dbo].[SystemUsers]') AND c.name = N'Username'
             AND t.name <> N'nvarchar')
  ALTER TABLE [dbo].[SystemUsers] ALTER COLUMN [Username] NVARCHAR(100) NOT NULL;
IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON c.user_type_id = t.user_type_id
           WHERE c.object_id = OBJECT_ID(N'[dbo].[SystemUsers]') AND c.name = N'Email'
             AND t.name <> N'nvarchar')
  ALTER TABLE [dbo].[SystemUsers] ALTER COLUMN [Email] NVARCHAR(200) NULL;
IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON c.user_type_id = t.user_type_id
           WHERE c.object_id = OBJECT_ID(N'[dbo].[SystemUsers]') AND c.name = N'FullName'
             AND t.name <> N'nvarchar')
  ALTER TABLE [dbo].[SystemUsers] ALTER COLUMN [FullName] NVARCHAR(200) NULL;
IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON c.user_type_id = t.user_type_id
           WHERE c.object_id = OBJECT_ID(N'[dbo].[SystemUsers]') AND c.name = N'PasswordHash'
             AND t.name <> N'nvarchar')
  ALTER TABLE [dbo].[SystemUsers] ALTER COLUMN [PasswordHash] NVARCHAR(255) NOT NULL;
IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON c.user_type_id = t.user_type_id
           WHERE c.object_id = OBJECT_ID(N'[dbo].[SystemUsers]') AND c.name = N'Role'
             AND t.name <> N'nvarchar')
  ALTER TABLE [dbo].[SystemUsers] ALTER COLUMN [Role] NVARCHAR(50) NOT NULL;
IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON c.user_type_id = t.user_type_id
           WHERE c.object_id = OBJECT_ID(N'[dbo].[SystemUsers]') AND c.name = N'AllowedDepartment'
             AND t.name <> N'nvarchar')
  ALTER TABLE [dbo].[SystemUsers] ALTER COLUMN [AllowedDepartment] NVARCHAR(50) NOT NULL;
IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON c.user_type_id = t.user_type_id
           WHERE c.object_id = OBJECT_ID(N'[dbo].[SystemUsers]') AND c.name = N'MfaSecretEncrypted'
             AND t.name <> N'nvarchar')
  ALTER TABLE [dbo].[SystemUsers] ALTER COLUMN [MfaSecretEncrypted] NVARCHAR(500) NULL;
IF EXISTS (SELECT 1 FROM sys.columns c JOIN sys.types t ON c.user_type_id = t.user_type_id
           WHERE c.object_id = OBJECT_ID(N'[dbo].[SystemUsers]') AND c.name = N'MfaBackupCodes'
             AND t.name <> N'nvarchar')
  ALTER TABLE [dbo].[SystemUsers] ALTER COLUMN [MfaBackupCodes] NVARCHAR(MAX) NULL;
GO

