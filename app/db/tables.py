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
    String,
    Table,
    Text,
    UniqueConstraint,
    func,
)
metadata = MetaData()

# Convenience column factories ------------------------------------------------
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
    Column("Name", String(200), nullable=False),
    Column("CompanyName", String(200), nullable=True),
    Column("BrandPrimaryColor", String(20), nullable=False, server_default="#6D5DFC"),
    Column("BrandAccentColor", String(20), nullable=False, server_default="#0F9F91"),
    Column("LogoUrl", String(500), nullable=True),
    Column("Locale", String(10), nullable=False, server_default="en"),
    Column("TimeZone", String(64), nullable=False, server_default="UTC"),
    Column("PlatformProvider", String(40), nullable=False, server_default="generic_sql"),
    Column("PlatformConfigJson", Text, nullable=True),
    Column("DataRetentionDays", Integer, nullable=False, server_default="730"),
    Column("IsActive", Boolean, nullable=False, server_default="1"),
    Column("CreatedAt", DateTime, server_default=func.now(), nullable=False),
    Column("UpdatedAt", DateTime, nullable=True),
)

SystemUsers = Table(
    "SystemUsers",
    metadata,
    pk("UserID"),
    Column("Username", String(100), nullable=False),
    Column("Email", String(200), nullable=True),
    Column("FullName", String(200), nullable=True),
    Column("PasswordHash", String(255), nullable=False),
    Column("Role", String(50), nullable=False, server_default="Viewer"),
    Column("AllowedDepartment", String(50), nullable=False, server_default="ALL"),
    Column("IsActive", Boolean, nullable=False, server_default="1"),
    Column("FailedLoginAttempts", Integer, nullable=False, server_default="0"),
    Column("LockedUntil", DateTime, nullable=True),
    Column("LastLoginDate", DateTime, nullable=True),
    Column("MustChangePassword", Boolean, nullable=False, server_default="0"),
    Column("PasswordChangedAt", DateTime, nullable=True),
    # --- MFA ---
    Column("MfaEnabled", Boolean, nullable=False, server_default="0"),
    Column("MfaSecretEncrypted", String(500), nullable=True),
    Column("MfaBackupCodes", Text, nullable=True),  # JSON array of peppered hashes
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
    Column("Role", String(50), nullable=False, index=True),
    Column("Permission", String(100), nullable=False),
    Column("GrantedBy", Integer, nullable=True),
    Column("CreatedAt", DateTime, server_default=func.now(), nullable=False),
    UniqueConstraint("Role", "Permission", name="UQ_RolePermissions"),
)

RefreshTokens = Table(
    "RefreshTokens",
    metadata,
    pk("TokenID"),
    Column("UserID", Integer, ForeignKey("SystemUsers.UserID", ondelete="CASCADE"), nullable=False, index=True),
    Column("TokenHash", String(128), nullable=False, unique=True),
    Column("ExpiresAt", DateTime, nullable=False, index=True),
    Column("RevokedAt", DateTime, nullable=True),
    Column("RevokedReason", String(200), nullable=True),
    Column("ReplacedByTokenID", Integer, nullable=True),
    Column("IPAddress", String(64), nullable=True),
    Column("UserAgent", String(400), nullable=True),
    Column("LastUsedAt", DateTime, nullable=True),
    Column("CreatedAt", DateTime, server_default=func.now(), nullable=False),
    Index("IX_RefreshTokens_User_Active", "UserID", "RevokedAt"),
)

AuditLogs = Table(
    "AuditLogs",
    metadata,
    pk_big("LogID"),
    Column("UserID", Integer, nullable=True, index=True),
    Column("ActionType", String(60), nullable=False, index=True),
    Column("ProcessName", String(100), nullable=True),
    Column("EntityType", String(50), nullable=True),
    Column("EntityID", String(80), nullable=True),
    Column("OldValues", Text, nullable=True),
    Column("NewValues", Text, nullable=True),
    Column("IPAddress", String(64), nullable=True),
    Column("UserAgent", String(400), nullable=True),
    Column("CorrelationID", String(64), nullable=True, index=True),
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
    Column("ProcessName", String(100), nullable=False),
    Column("Department", String(50), nullable=False, server_default="Operations", index=True),
    Column("BotName", String(100), nullable=True),
    Column("Provider", String(40), nullable=False, server_default="generic_sql"),
    Column("PlatformProcessKey", String(200), nullable=True),
    Column("ExpectedRunsPerDay", Integer, nullable=False, server_default="0"),
    Column("HourlyRate", Numeric(10, 2), nullable=False, server_default="50"),
    Column("EmpMinutesPerRequest", Numeric(10, 2), nullable=False, server_default="15"),
    Column("EmpCostPerRequest", Numeric(10, 2), nullable=False, server_default="10"),
    Column("BotCostPerRequest", Numeric(10, 2), nullable=False, server_default="0.5"),
    Column("SLATargetMinutes", Integer, nullable=False, server_default="0"),
    Column("Criticality", String(20), nullable=False, server_default="Medium"),
    Column("SLAWarningRatio", Float, nullable=False, server_default="0.75"),
    Column("IsActive", Boolean, nullable=False, server_default="1"),
    Column("Notes", String(500), nullable=True),
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
    Column("ProcessName", String(100), nullable=False),
    Column("RequestID", String(100), nullable=True),
    Column("Status", String(20), nullable=False, index=True),
    Column("StartTime", DateTime, nullable=False, index=True),
    Column("EndTime", DateTime, nullable=True),
    Column("DurationMinutes", Numeric(10, 2), nullable=True),
    Column("FailureReason", String(500), nullable=True),
    Column("TransactionsCount", Integer, nullable=False, server_default="0"),
    Column("SuccessCount", Integer, nullable=False, server_default="0"),
    Column("FailedCount", Integer, nullable=False, server_default="0"),
    Column("TimeSavedHours", Numeric(10, 2), nullable=False, server_default="0"),
    Column("CostSaved", Numeric(12, 2), nullable=False, server_default="0"),
    # --- ingestion / multi-vendor telemetry ---
    Column("IdempotencyKey", String(120), nullable=True),
    Column("MachineName", String(100), nullable=True, index=True),
    Column("RobotName", String(100), nullable=True),
    Column("Provider", String(40), nullable=True),
    Column("ProviderRunId", String(200), nullable=True),
    Column("ExitCode", String(40), nullable=True),
    Column("Trigger", String(40), nullable=True),  # schedule | manual | api | agent
    Column("TriggeredBy", String(100), nullable=True),
    Column("TriggerReason", String(300), nullable=True),
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
    Column("ProcessName", String(100), nullable=False),
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
    Column("ProcessName", String(100), nullable=False, index=True),
    Column("PendingItems", Integer, nullable=False, server_default="0"),
    Column("ActiveItems", Integer, nullable=False, server_default="0"),
    Column("CapturedAt", DateTime, server_default=func.now(), nullable=False, index=True),
    Index("IX_QueueSnapshots_Process_Time", "ProcessName", "CapturedAt"),
)

BotInfrastructure = Table(
    "BotInfrastructure",
    metadata,
    pk("MachineID"),
    Column("MachineName", String(100), nullable=False),
    Column("AssignedProcess", String(100), nullable=True),
    Column("Status", String(20), nullable=False, server_default="Offline"),
    Column("CPU_Usage", Integer, nullable=False, server_default="0"),
    Column("RAM_Usage", Integer, nullable=False, server_default="0"),
    Column("HDD_Usage", Integer, nullable=False, server_default="0"),
    Column("LastPing", DateTime, nullable=True),
    Column("TotalRAM_GB", Integer, nullable=False, server_default="0"),
    Column("TotalHDD_GB", Integer, nullable=False, server_default="0"),
    Column("RunnerType", String(20), nullable=False, server_default="Unattended"),
    Column("Platform", String(40), nullable=False, server_default="generic_sql"),
    Column("RobotCapacity", Integer, nullable=False, server_default="1"),
    Column("AgentToken", String(200), nullable=True),
    Column("AgentTokenIssuedAt", DateTime, nullable=True),
    Column("LastIP", String(64), nullable=True),
    Column("OSName", String(64), nullable=True),
    Column("AgentVersion", String(40), nullable=True),
    *soft_delete_columns(),
    *audit_stamp_columns(),
    UniqueConstraint("MachineName", name="UQ_BotInfrastructure_Machine"),
    Index("IX_BotInfrastructure_Status", "Status"),
)

AgentEnrollmentCodes = Table(
    "AgentEnrollmentCodes",
    metadata,
    pk("CodeID"),
    Column("MachineName", String(100), nullable=False, index=True),
    Column("EnrollmentCode", String(40), nullable=False, index=True),
    Column("ExpiresAt", DateTime, nullable=False),
    Column("IsUsed", Boolean, nullable=False, server_default="0"),
    Column("CreatedAt", DateTime, server_default=func.now(), nullable=False),
)

BotVersions = Table(
    "BotVersions",
    metadata,
    pk("VersionID"),
    Column("ProcessName", String(100), nullable=False, index=True),
    Column("VersionTag", String(40), nullable=False),
    Column("CurrentStatus", String(40), nullable=False, server_default="Development"),
    Column("TargetMachineName", String(100), nullable=True),
    Column("CreatedBy", Integer, nullable=True),
    Column("CreatedAt", DateTime, server_default=func.now(), nullable=False),
    Column("LastPromotedAt", DateTime, nullable=True),
    Column("Notes", Text, nullable=True),
    Column("ArtifactUrl", String(500), nullable=True),
    Column("HealthScore", Float, nullable=True),
    *soft_delete_columns(),
    UniqueConstraint("ProcessName", "VersionTag", name="UQ_BotVersions_Process_Tag"),
)

BotVault = Table(
    "BotVault",
    metadata,
    pk("VaultID"),
    Column("VersionID", Integer, ForeignKey("BotVersions.VersionID", ondelete="CASCADE"), nullable=False, index=True),
    Column("CredentialName", String(100), nullable=False),
    Column("Environment", String(20), nullable=False, server_default="Development"),
    Column("EncryptedValue", Text, nullable=False),
    Column("KeyVersion", String(20), nullable=False, server_default="1"),
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
    Column("PreviousStatus", String(40), nullable=False),
    Column("NewStatus", String(40), nullable=False),
    Column("PromotedBy", Integer, nullable=True),
    Column("PromotedAt", DateTime, server_default=func.now(), nullable=False),
    Column("IPAddress", String(64), nullable=True),
    Column("Comment", String(500), nullable=True),
)

ApprovalRequests = Table(
    "ApprovalRequests",
    metadata,
    pk("ApprovalID"),
    Column("VersionID", Integer, nullable=False, index=True),
    Column("ProcessName", String(100), nullable=False),
    Column("TargetEnvironment", String(40), nullable=False),
    Column("RequestedBy", Integer, nullable=False),
    Column("RequestedAt", DateTime, server_default=func.now(), nullable=False),
    Column("Status", String(20), nullable=False, server_default="Pending", index=True),
    Column("ApprovedBy", Integer, nullable=True),
    Column("DecidedAt", DateTime, nullable=True),
    Column("Comment", String(500), nullable=True),
    Column("RiskNotes", Text, nullable=True),
)

Recommendations = Table(
    "Recommendations",
    metadata,
    pk_big("RecommendationID"),
    Column("Kind", String(60), nullable=False, index=True),
    Column("Severity", String(20), nullable=False, index=True),
    Column("ProcessName", String(100), nullable=True, index=True),
    Column("Department", String(50), nullable=True),
    Column("Title", String(300), nullable=False),
    Column("Detail", Text, nullable=True),
    Column("MetricsJson", Text, nullable=True),
    Column("SuggestedAction", String(200), nullable=True),
    Column("ActionPayloadJson", Text, nullable=True),
    Column("Status", String(20), nullable=False, server_default="Open", index=True),
    Column("Fingerprint", String(120), nullable=True, index=True),
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
    Column("MachineName", String(100), nullable=False, index=True),
    Column("Command", String(200), nullable=False),
    Column("PayloadJson", Text, nullable=True),
    Column("Status", String(20), nullable=False, server_default="Queued", index=True),
    Column("IssuedBy", Integer, nullable=True),
    Column("IssuedAt", DateTime, server_default=func.now(), nullable=False),
    Column("SentAt", DateTime, nullable=True),
    Column("AckedAt", DateTime, nullable=True),
    Column("Result", String(500), nullable=True),
    Column("TimeoutSeconds", Integer, nullable=False, server_default="60"),
    Column("Signature", String(128), nullable=True),
    Column("ScheduledAt", DateTime, nullable=True),
    Index("IX_BotCommands_StatusIssued", "Status", "IssuedAt"),
)

NotificationLog = Table(
    "NotificationLog",
    metadata,
    pk_big("NotificationID"),
    Column("Channel", String(30), nullable=False, index=True),
    Column("Target", String(300), nullable=True),
    Column("Subject", String(300), nullable=False),
    Column("Body", Text, nullable=True),
    Column("Status", String(20), nullable=False, server_default="Pending", index=True),
    Column("Error", String(500), nullable=True),
    Column("RelatedType", String(40), nullable=True),
    Column("RelatedID", String(80), nullable=True),
    Column("DedupeKey", String(160), nullable=True, index=True),
    Column("CreatedAt", DateTime, server_default=func.now(), nullable=False, index=True),
    Column("SentAt", DateTime, nullable=True),
)

PlatformSyncLog = Table(
    "PlatformSyncLog",
    metadata,
    pk_big("SyncID"),
    Column("Provider", String(40), nullable=False),
    Column("Operation", String(60), nullable=False),
    Column("Status", String(20), nullable=False),
    Column("ItemsSynced", Integer, nullable=False, server_default="0"),
    Column("DurationMs", Integer, nullable=True),
    Column("Error", String(500), nullable=True),
    Column("StartedAt", DateTime, server_default=func.now(), nullable=False, index=True),
)

PasswordHistory = Table(
    "PasswordHistory",
    metadata,
    pk_big("HistoryID"),
    Column("UserID", Integer, ForeignKey("SystemUsers.UserID", ondelete="CASCADE"), nullable=False, index=True),
    Column("PasswordHash", String(255), nullable=False),
    Column("CreatedAt", DateTime, server_default=func.now(), nullable=False, index=True),
)

Alerts = Table(
    "Alerts",
    metadata,
    pk_big("AlertID"),
    Column("RuleKey", String(80), nullable=False, index=True),
    Column("Severity", String(20), nullable=False, server_default="Warning", index=True),
    Column("Title", String(300), nullable=False),
    Column("Detail", Text, nullable=True),
    Column("EntityType", String(50), nullable=True),
    Column("EntityID", String(100), nullable=True, index=True),
    Column("Status", String(20), nullable=False, server_default="Open", index=True),
    Column("DedupeKey", String(200), nullable=False, unique=True, index=True),
    Column("Fingerprint", String(200), nullable=True, index=True),
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
    Column("Version", String(40), primary_key=True),
    Column("Description", String(300), nullable=True),
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
