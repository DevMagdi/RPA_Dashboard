"""Canonical database schema (shared by SQL Server, PostgreSQL and SQLite).

The metadata below is the single source of truth for the platform's data model.
It intentionally keeps the original ``PascalCase`` table/column names so that
existing bank databases migrate in place, while adding the enterprise features
required by the transformation:

* **single organization** — one installation serves exactly one bank /
  enterprise; there is no cross-organization data and no organization
  discriminator column on business tables. The singleton ``Organization``
  row holds branding / platform configuration for the whole installation.
* **soft delete & retention** — ``IsDeleted`` / ``DeletedAt`` / ``RetentionDays``
* **multi-vendor** — ``Provider`` / ``PlatformProcessKey`` / ``ProviderRunId``
* **audit fidelity** — ``CorrelationID`` / ``UserAgent`` on ``AuditLogs``
* **MFA & sessions** — ``MfaSecretEncrypted``, ``RefreshTokens``
* **capacity advisor** — ``Recommendations``, ``QueueSnapshots``
* **governance** — ``ApprovalRequests``, ``BotCommands``, ``NotificationLog``, ``Alerts``

``metadata.create_all(engine)`` bootstraps a fresh database on any dialect;
production upgrades use the migration scripts under ``db/migrations``.
"""

from __future__ import annotations

from sqlalchemy import (
    BigInteger,
    Boolean,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    MetaData,
    Numeric,
    Table,
    Unicode,
    UnicodeText,
    UniqueConstraint,
    func,
)
metadata = MetaData()

# Text columns are declared with SQLAlchemy's **Unicode** types, never with
# ``String``/``Text``.  On SQL Server ``String(n)`` compiles to ``VARCHAR(n)``,
# which stores one byte per character under a Latin collation: Arabic process
# names, audit details and user full names were being persisted as ``????``
# (irreversible — the original characters never reach the database).  The
# Unicode types compile to ``NVARCHAR(n)`` / ``NVARCHAR(MAX)`` on SQL Server
# and stay ``VARCHAR``/``TEXT`` on PostgreSQL and SQLite, so the schema remains
# portable while the bank's Arabic text survives every dialect.
# Existing installations are repaired in place by ``app.db.unicode_upgrade``
# (script: ``db/migrations/sqlserver/005_unicode_nvarchar_upgrade.sql``).


def pk(name: str) -> Column:
    """Auto-increment integer primary key."""
    return Column(name, Integer, primary_key=True, autoincrement=True)


def pk_big(name: str) -> Column:
    """Big auto-increment primary key for high-volume telemetry tables.

    SQLite requires the literal type ``INTEGER PRIMARY KEY`` to auto-increment,
    so ``BIGINT`` is downgraded to ``Integer`` on that dialect only.
    """
    return Column(name, BigInteger().with_variant(Integer, "sqlite"), primary_key=True, autoincrement=True)


def soft_delete_columns() -> list[Column]:
    """``IsDeleted`` / ``DeletedAt`` pair for logical deletion."""
    return [
        Column("IsDeleted", Boolean, nullable=False, server_default="0"),
        Column("DeletedAt", DateTime, nullable=True),
    ]


def audit_stamp_columns() -> list[Column]:
    """``CreatedAt`` / ``UpdatedAt`` audit columns."""
    return [
        Column("CreatedAt", DateTime, server_default=func.now(), nullable=False),
        Column("UpdatedAt", DateTime, nullable=True),
    ]


# --------------------------------------------------------------------------- #
# Tenancy & identity
# --------------------------------------------------------------------------- #
Organization = Table(
    "Organization",
    metadata,
    pk("OrganizationID"),
    Column("Name", Unicode(200), nullable=False),
    Column("CompanyName", Unicode(200), nullable=True),
    Column("BrandPrimaryColor", Unicode(20), nullable=False, server_default="#6D5DFC"),
    Column("BrandAccentColor", Unicode(20), nullable=False, server_default="#0F9F91"),
    Column("LogoUrl", Unicode(500), nullable=True),
    Column("Locale", Unicode(10), nullable=False, server_default="en"),
    Column("TimeZone", Unicode(64), nullable=False, server_default="UTC"),
    Column("PlatformProvider", Unicode(40), nullable=False, server_default="generic_sql"),
    Column("PlatformConfigJson", UnicodeText, nullable=True),
    Column("DataRetentionDays", Integer, nullable=False, server_default="730"),
    Column("IsActive", Boolean, nullable=False, server_default="1"),
    Column("CreatedAt", DateTime, server_default=func.now(), nullable=False),
    Column("UpdatedAt", DateTime, nullable=True),
)

SystemUsers = Table(
    "SystemUsers",
    metadata,
    pk("UserID"),
    Column("Username", Unicode(100), nullable=False),
    Column("Email", Unicode(200), nullable=True),
    Column("FullName", Unicode(200), nullable=True),
    Column("PasswordHash", Unicode(255), nullable=False),
    Column("Role", Unicode(50), nullable=False, server_default="Viewer"),
    Column("AllowedDepartment", Unicode(50), nullable=False, server_default="ALL"),
    Column("IsActive", Boolean, nullable=False, server_default="1"),
    Column("FailedLoginAttempts", Integer, nullable=False, server_default="0"),
    Column("LockedUntil", DateTime, nullable=True),
    Column("LastLoginDate", DateTime, nullable=True),
    Column("MustChangePassword", Boolean, nullable=False, server_default="0"),
    Column("PasswordChangedAt", DateTime, nullable=True),
    # --- MFA ---
    Column("MfaEnabled", Boolean, nullable=False, server_default="0"),
    Column("MfaSecretEncrypted", Unicode(500), nullable=True),
    Column("MfaBackupCodes", UnicodeText, nullable=True),  # JSON array of peppered hashes
    Column("MfaEnrolledAt", DateTime, nullable=True),
    Column("LastMfaVerifiedAt", DateTime, nullable=True),
    *soft_delete_columns(),
    *audit_stamp_columns(),
    UniqueConstraint("Username", name="UQ_SystemUsers_Username"),
    Index("IX_SystemUsers_Role", "Role"),
)

RolePermissions = Table(
    "RolePermissions",
    metadata,
    pk("PermissionID"),
    Column("Role", Unicode(50), nullable=False, index=True),
    Column("Permission", Unicode(100), nullable=False),
    Column("GrantedBy", Integer, nullable=True),
    Column("CreatedAt", DateTime, server_default=func.now(), nullable=False),
    UniqueConstraint("Role", "Permission", name="UQ_RolePermissions"),
)

RefreshTokens = Table(
    "RefreshTokens",
    metadata,
    pk("TokenID"),
    Column("UserID", Integer, ForeignKey("SystemUsers.UserID", ondelete="CASCADE"), nullable=False, index=True),
    Column("TokenHash", Unicode(128), nullable=False, unique=True),
    Column("ExpiresAt", DateTime, nullable=False, index=True),
    Column("RevokedAt", DateTime, nullable=True),
    Column("RevokedReason", Unicode(200), nullable=True),
    Column("ReplacedByTokenID", Integer, nullable=True),
    Column("IPAddress", Unicode(64), nullable=True),
    Column("UserAgent", Unicode(400), nullable=True),
    Column("LastUsedAt", DateTime, nullable=True),
    Column("CreatedAt", DateTime, server_default=func.now(), nullable=False),
    Index("IX_RefreshTokens_User_Active", "UserID", "RevokedAt"),
)

AuditLogs = Table(
    "AuditLogs",
    metadata,
    pk_big("LogID"),
    Column("UserID", Integer, nullable=True, index=True),
    Column("ActionType", Unicode(60), nullable=False, index=True),
    Column("ProcessName", Unicode(100), nullable=True),
    Column("EntityType", Unicode(50), nullable=True),
    Column("EntityID", Unicode(80), nullable=True),
    Column("OldValues", UnicodeText, nullable=True),
    Column("NewValues", UnicodeText, nullable=True),
    Column("IPAddress", Unicode(64), nullable=True),
    Column("UserAgent", Unicode(400), nullable=True),
    Column("CorrelationID", Unicode(64), nullable=True, index=True),
    Column("IsSuccess", Boolean, nullable=False, server_default="1"),
    Column("ActionDate", DateTime, server_default=func.now(), nullable=False, index=True),
    Index("IX_AuditLogs_Date", "ActionDate"),
    Index("IX_AuditLogs_Action", "ActionType", "ActionDate"),
)

# --------------------------------------------------------------------------- #
# Automation domain
# --------------------------------------------------------------------------- #
ProcessConfig = Table(
    "ProcessConfig",
    metadata,
    pk("ConfigID"),
    Column("ProcessName", Unicode(100), nullable=False),
    Column("Department", Unicode(50), nullable=False, server_default="Operations", index=True),
    Column("BotName", Unicode(100), nullable=True),
    Column("Provider", Unicode(40), nullable=False, server_default="generic_sql"),
    Column("PlatformProcessKey", Unicode(200), nullable=True),
    Column("ExpectedRunsPerDay", Integer, nullable=False, server_default="0"),
    Column("HourlyRate", Numeric(10, 2), nullable=False, server_default="50"),
    Column("EmpMinutesPerRequest", Numeric(10, 2), nullable=False, server_default="15"),
    Column("EmpCostPerRequest", Numeric(10, 2), nullable=False, server_default="10"),
    Column("BotCostPerRequest", Numeric(10, 2), nullable=False, server_default="0.5"),
    Column("SLATargetMinutes", Integer, nullable=False, server_default="0"),
    Column("Criticality", Unicode(20), nullable=False, server_default="Medium"),
    Column("SLAWarningRatio", Float, nullable=False, server_default="0.75"),
    Column("IsActive", Boolean, nullable=False, server_default="1"),
    Column("Notes", Unicode(500), nullable=True),
    Column("RetentionDays", Integer, nullable=True),
    *soft_delete_columns(),
    *audit_stamp_columns(),
    UniqueConstraint("ProcessName", name="UQ_ProcessConfig_Process"),
    Index("IX_ProcessConfig_Dept", "Department"),
)

ProcessRuns = Table(
    "ProcessRuns",
    metadata,
    pk_big("RunID"),
    Column("ProcessName", Unicode(100), nullable=False),
    Column("RequestID", Unicode(100), nullable=True),
    Column("Status", Unicode(20), nullable=False, index=True),
    Column("StartTime", DateTime, nullable=False, index=True),
    Column("EndTime", DateTime, nullable=True),
    Column("DurationMinutes", Numeric(10, 2), nullable=True),
    Column("FailureReason", Unicode(500), nullable=True),
    Column("TransactionsCount", Integer, nullable=False, server_default="0"),
    Column("SuccessCount", Integer, nullable=False, server_default="0"),
    Column("FailedCount", Integer, nullable=False, server_default="0"),
    Column("TimeSavedHours", Numeric(10, 2), nullable=False, server_default="0"),
    Column("CostSaved", Numeric(12, 2), nullable=False, server_default="0"),
    # --- ingestion / multi-vendor telemetry ---
    Column("IdempotencyKey", Unicode(120), nullable=True),
    Column("MachineName", Unicode(100), nullable=True, index=True),
    Column("RobotName", Unicode(100), nullable=True),
    Column("Provider", Unicode(40), nullable=True),
    Column("ProviderRunId", Unicode(200), nullable=True),
    Column("ExitCode", Unicode(40), nullable=True),
    Column("Trigger", Unicode(40), nullable=True),  # schedule | manual | api | agent
    Column("TriggeredBy", Unicode(100), nullable=True),
    Column("TriggerReason", Unicode(300), nullable=True),
    Column("LastHeartbeatAt", DateTime, nullable=True),
    *soft_delete_columns(),
    *audit_stamp_columns(),
    UniqueConstraint("IdempotencyKey", name="UQ_ProcessRuns_Idempotency"),
    Index("IX_ProcessRuns_Start", "StartTime"),
    Index("IX_ProcessRuns_Process_Start", "ProcessName", "StartTime"),
    Index("IX_ProcessRuns_Status_Start", "Status", "StartTime"),
)

ProcessQueues = Table(
    "ProcessQueues",
    metadata,
    pk("QueueID"),
    Column("ProcessName", Unicode(100), nullable=False),
    Column("PendingItems", Integer, nullable=False, server_default="0"),
    Column("ActiveItems", Integer, nullable=False, server_default="0"),
    Column("AvgItemProcessingSeconds", Integer, nullable=False, server_default="30"),
    Column("LastUpdatedAt", DateTime, server_default=func.now(), nullable=False),
    *soft_delete_columns(),
    UniqueConstraint("ProcessName", name="UQ_ProcessQueues_Process"),
)

QueueSnapshots = Table(
    "QueueSnapshots",
    metadata,
    pk_big("SnapshotID"),
    Column("ProcessName", Unicode(100), nullable=False, index=True),
    Column("PendingItems", Integer, nullable=False, server_default="0"),
    Column("ActiveItems", Integer, nullable=False, server_default="0"),
    Column("CapturedAt", DateTime, server_default=func.now(), nullable=False, index=True),
    Index("IX_QueueSnapshots_Process_Time", "ProcessName", "CapturedAt"),
)

BotInfrastructure = Table(
    "BotInfrastructure",
    metadata,
    pk("MachineID"),
    Column("MachineName", Unicode(100), nullable=False),
    Column("AssignedProcess", Unicode(100), nullable=True),
    Column("Status", Unicode(20), nullable=False, server_default="Offline"),
    Column("CPU_Usage", Integer, nullable=False, server_default="0"),
    Column("RAM_Usage", Integer, nullable=False, server_default="0"),
    Column("HDD_Usage", Integer, nullable=False, server_default="0"),
    Column("LastPing", DateTime, nullable=True),
    Column("TotalRAM_GB", Integer, nullable=False, server_default="0"),
    Column("TotalHDD_GB", Integer, nullable=False, server_default="0"),
    Column("RunnerType", Unicode(20), nullable=False, server_default="Unattended"),
    Column("Platform", Unicode(40), nullable=False, server_default="generic_sql"),
    Column("RobotCapacity", Integer, nullable=False, server_default="1"),
    Column("AgentToken", Unicode(200), nullable=True),
    Column("AgentTokenIssuedAt", DateTime, nullable=True),
    Column("LastIP", Unicode(64), nullable=True),
    Column("OSName", Unicode(64), nullable=True),
    Column("AgentVersion", Unicode(40), nullable=True),
    *soft_delete_columns(),
    *audit_stamp_columns(),
    UniqueConstraint("MachineName", name="UQ_BotInfrastructure_Machine"),
    Index("IX_BotInfrastructure_Status", "Status"),
)

AgentEnrollmentCodes = Table(
    "AgentEnrollmentCodes",
    metadata,
    pk("CodeID"),
    Column("MachineName", Unicode(100), nullable=False, index=True),
    Column("EnrollmentCode", Unicode(40), nullable=False, index=True),
    Column("ExpiresAt", DateTime, nullable=False),
    Column("IsUsed", Boolean, nullable=False, server_default="0"),
    Column("CreatedAt", DateTime, server_default=func.now(), nullable=False),
)

BotVersions = Table(
    "BotVersions",
    metadata,
    pk("VersionID"),
    Column("ProcessName", Unicode(100), nullable=False, index=True),
    Column("VersionTag", Unicode(40), nullable=False),
    Column("CurrentStatus", Unicode(40), nullable=False, server_default="Development"),
    Column("TargetMachineName", Unicode(100), nullable=True),
    Column("CreatedBy", Integer, nullable=True),
    Column("CreatedAt", DateTime, server_default=func.now(), nullable=False),
    Column("LastPromotedAt", DateTime, nullable=True),
    Column("Notes", UnicodeText, nullable=True),
    Column("ArtifactUrl", Unicode(500), nullable=True),
    Column("HealthScore", Float, nullable=True),
    *soft_delete_columns(),
    UniqueConstraint("ProcessName", "VersionTag", name="UQ_BotVersions_Process_Tag"),
)

BotVault = Table(
    "BotVault",
    metadata,
    pk("VaultID"),
    Column("VersionID", Integer, ForeignKey("BotVersions.VersionID", ondelete="CASCADE"), nullable=False, index=True),
    Column("CredentialName", Unicode(100), nullable=False),
    Column("Environment", Unicode(20), nullable=False, server_default="Development"),
    Column("EncryptedValue", UnicodeText, nullable=False),
    Column("KeyVersion", Unicode(20), nullable=False, server_default="1"),
    Column("CreatedBy", Integer, nullable=True),
    Column("CreatedAt", DateTime, server_default=func.now(), nullable=False),
    Column("LastAccessedAt", DateTime, nullable=True),
    Column("AccessCount", Integer, nullable=False, server_default="0"),
    Column("ExpiresAt", DateTime, nullable=True),
    *soft_delete_columns(),
)

PromotionAuditLog = Table(
    "PromotionAuditLog",
    metadata,
    pk("PromotionID"),
    Column("VersionID", Integer, nullable=False, index=True),
    Column("PreviousStatus", Unicode(40), nullable=False),
    Column("NewStatus", Unicode(40), nullable=False),
    Column("PromotedBy", Integer, nullable=True),
    Column("PromotedAt", DateTime, server_default=func.now(), nullable=False),
    Column("IPAddress", Unicode(64), nullable=True),
    Column("Comment", Unicode(500), nullable=True),
)

ApprovalRequests = Table(
    "ApprovalRequests",
    metadata,
    pk("ApprovalID"),
    Column("VersionID", Integer, nullable=False, index=True),
    Column("ProcessName", Unicode(100), nullable=False),
    Column("TargetEnvironment", Unicode(40), nullable=False),
    Column("RequestedBy", Integer, nullable=False),
    Column("RequestedAt", DateTime, server_default=func.now(), nullable=False),
    Column("Status", Unicode(20), nullable=False, server_default="Pending", index=True),
    Column("ApprovedBy", Integer, nullable=True),
    Column("DecidedAt", DateTime, nullable=True),
    Column("Comment", Unicode(500), nullable=True),
    Column("RiskNotes", UnicodeText, nullable=True),
)

Recommendations = Table(
    "Recommendations",
    metadata,
    pk_big("RecommendationID"),
    Column("Kind", Unicode(60), nullable=False, index=True),
    Column("Severity", Unicode(20), nullable=False, index=True),
    Column("ProcessName", Unicode(100), nullable=True, index=True),
    Column("Department", Unicode(50), nullable=True),
    Column("Title", Unicode(300), nullable=False),
    Column("Detail", UnicodeText, nullable=True),
    Column("MetricsJson", UnicodeText, nullable=True),
    Column("SuggestedAction", Unicode(200), nullable=True),
    Column("ActionPayloadJson", UnicodeText, nullable=True),
    Column("Status", Unicode(20), nullable=False, server_default="Open", index=True),
    Column("Fingerprint", Unicode(120), nullable=True, index=True),
    Column("CreatedAt", DateTime, server_default=func.now(), nullable=False, index=True),
    Column("AcknowledgedBy", Integer, nullable=True),
    Column("AcknowledgedAt", DateTime, nullable=True),
    Column("AppliedAt", DateTime, nullable=True),
    Index("IX_Recommendations_Status_Created", "Status", "CreatedAt"),
)

BotCommands = Table(
    "BotCommands",
    metadata,
    pk_big("CommandID"),
    Column("MachineName", Unicode(100), nullable=False, index=True),
    Column("Command", Unicode(200), nullable=False),
    Column("PayloadJson", UnicodeText, nullable=True),
    Column("Status", Unicode(20), nullable=False, server_default="Queued", index=True),
    Column("IssuedBy", Integer, nullable=True),
    Column("IssuedAt", DateTime, server_default=func.now(), nullable=False),
    Column("SentAt", DateTime, nullable=True),
    Column("AckedAt", DateTime, nullable=True),
    Column("Result", Unicode(500), nullable=True),
    Column("TimeoutSeconds", Integer, nullable=False, server_default="60"),
    Column("Signature", Unicode(128), nullable=True),
    Column("ScheduledAt", DateTime, nullable=True),
    Index("IX_BotCommands_StatusIssued", "Status", "IssuedAt"),
)

NotificationLog = Table(
    "NotificationLog",
    metadata,
    pk_big("NotificationID"),
    Column("Channel", Unicode(30), nullable=False, index=True),
    Column("Target", Unicode(300), nullable=True),
    Column("Subject", Unicode(300), nullable=False),
    Column("Body", UnicodeText, nullable=True),
    Column("Status", Unicode(20), nullable=False, server_default="Pending", index=True),
    Column("Error", Unicode(500), nullable=True),
    Column("RelatedType", Unicode(40), nullable=True),
    Column("RelatedID", Unicode(80), nullable=True),
    Column("DedupeKey", Unicode(160), nullable=True, index=True),
    Column("CreatedAt", DateTime, server_default=func.now(), nullable=False, index=True),
    Column("SentAt", DateTime, nullable=True),
)

PlatformSyncLog = Table(
    "PlatformSyncLog",
    metadata,
    pk_big("SyncID"),
    Column("Provider", Unicode(40), nullable=False),
    Column("Operation", Unicode(60), nullable=False),
    Column("Status", Unicode(20), nullable=False),
    Column("ItemsSynced", Integer, nullable=False, server_default="0"),
    Column("DurationMs", Integer, nullable=True),
    Column("Error", Unicode(500), nullable=True),
    Column("StartedAt", DateTime, server_default=func.now(), nullable=False, index=True),
)

PasswordHistory = Table(
    "PasswordHistory",
    metadata,
    pk_big("HistoryID"),
    Column("UserID", Integer, ForeignKey("SystemUsers.UserID", ondelete="CASCADE"), nullable=False, index=True),
    Column("PasswordHash", Unicode(255), nullable=False),
    Column("CreatedAt", DateTime, server_default=func.now(), nullable=False, index=True),
)

Alerts = Table(
    "Alerts",
    metadata,
    pk_big("AlertID"),
    Column("RuleKey", Unicode(80), nullable=False, index=True),
    Column("Severity", Unicode(20), nullable=False, server_default="Warning", index=True),
    Column("Title", Unicode(300), nullable=False),
    Column("Detail", UnicodeText, nullable=True),
    Column("EntityType", Unicode(50), nullable=True),
    Column("EntityID", Unicode(100), nullable=True, index=True),
    Column("Status", Unicode(20), nullable=False, server_default="Open", index=True),
    Column("DedupeKey", Unicode(200), nullable=False, unique=True, index=True),
    Column("Fingerprint", Unicode(200), nullable=True, index=True),
    Column("FirstSeenAt", DateTime, server_default=func.now(), nullable=False),
    Column("LastSeenAt", DateTime, server_default=func.now(), nullable=False, index=True),
    Column("OccurrenceCount", Integer, nullable=False, server_default="1"),
    Column("AcknowledgedBy", Integer, nullable=True),
    Column("AcknowledgedAt", DateTime, nullable=True),
    Column("ResolvedBy", Integer, nullable=True),
    Column("ResolvedAt", DateTime, nullable=True),
    Column("NotifiedAt", DateTime, nullable=True),
    Index("IX_Alerts_StatusLastSeen", "Status", "LastSeenAt"),
)

SchemaVersions = Table(
    "SchemaVersions",
    metadata,
    Column("Version", Unicode(40), primary_key=True),
    Column("Description", Unicode(300), nullable=True),
    Column("AppliedAt", DateTime, server_default=func.now(), nullable=False),
)

__all__ = [
    "metadata",
    "Organization",
    "SystemUsers",
    "RolePermissions",
    "RefreshTokens",
    "AuditLogs",
    "ProcessConfig",
    "ProcessRuns",
    "ProcessQueues",
    "QueueSnapshots",
    "BotInfrastructure",
    "AgentEnrollmentCodes",
    "BotVersions",
    "BotVault",
    "PromotionAuditLog",
    "ApprovalRequests",
    "Recommendations",
    "BotCommands",
    "NotificationLog",
    "PlatformSyncLog",
    "PasswordHistory",
    "Alerts",
    "SchemaVersions",
]
