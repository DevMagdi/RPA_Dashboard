"""Database bootstrap: schema creation, organization/role seeding and demo data.

Used by
* the automated test-suite (SQLite in-memory),
* local development & demos (``python -m app.db.bootstrap --seed-demo``),
* first-run of a fresh on-prem install.

Production banks create the schema through ``db/migrations`` (T-SQL) and only
use this module for the organization/role seed.
"""

from __future__ import annotations

import argparse
import logging
import os
import random
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from sqlalchemy import inspect
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.security import check_password_policy, hash_password
from app.db.repository import fetch_one, fetch_scalar, insert_row, update_rows
from app.db.session import dispose_engine, get_engine, session_scope
from app.db.tables import (
    BotInfrastructure,
    BotVersions,
    ProcessConfig,
    ProcessQueues,
    ProcessRuns,
    RolePermissions,
    SchemaVersions,
    SystemUsers,
    Organization,
    metadata,
)

logger = logging.getLogger(__name__)

SCHEMA_VERSION = "4.1.0"

# Shipped brand identity (Navy · Indigo · Teal · Orange). The SPA tokens
# (`rpa-dashboard/src/index.css` → `--brand`) and the seeded organization row
# must always agree, so the value lives here once and is referenced by name.
DEFAULT_BRAND_PRIMARY = "#4F46E5"
#: Previously shipped defaults. A row still carrying one of these follows the
#: new identity on bootstrap; an admin-chosen colour is never rewritten.
LEGACY_BRAND_PRIMARY = ("#5B21B6",)

# --------------------------------------------------------------------------- #
# Role → permission matrix (kept in the DB so banks can customise it live)
# --------------------------------------------------------------------------- #
ROLE_PERMISSIONS: Dict[str, List[str]] = {
    "SuperAdmin": ["*"],
    "CoE_Manager": [
        "dashboard:read",
        "processes:read",
        "processes:write",
        "roi:write",
        "sla:write",
        "lifecycle:read",
        "lifecycle:write",
        "lifecycle:promote",
        "lifecycle:approve",
        "infrastructure:read",
        "infrastructure:write",
        "capacity:read",
        "capacity:act",
        "audit:read",
        "export:read",
        "commands:write",
        "users:read",
    ],
    "Operator": [
        "dashboard:read",
        "processes:read",
        "lifecycle:read",
        "infrastructure:read",
        "capacity:read",
        "commands:write",
        "export:read",
    ],
    "Auditor": [
        "dashboard:read",
        "processes:read",
        "lifecycle:read",
        "infrastructure:read",
        "audit:read",
        "export:read",
    ],
    "Viewer": ["dashboard:read", "processes:read", "lifecycle:read", "infrastructure:read"],
}


def create_schema() -> None:
    """Create every table that does not exist yet (idempotent)."""
    engine = get_engine()
    metadata.create_all(engine)
    logger.info("Schema ensured (%d tables)", len(metadata.tables))


def record_schema_version(version: str = SCHEMA_VERSION, description: str = "initial canonical schema") -> None:
    """Insert the schema version marker when missing."""
    with session_scope() as session:
        exists = fetch_scalar(session, "SELECT Version FROM SchemaVersions WHERE Version = :v", {"v": version})
        if not exists:
            insert_row(session, SchemaVersions, {"Version": version, "Description": description})


def ensure_organization(
    session: Session,
    *,
    name: str = "Organization",
    company_name: Optional[str] = None,
    primary_color: str = DEFAULT_BRAND_PRIMARY,
    accent_color: str = "#0D9488",
    provider: str = "generic_sql",
    locale: str = "en",
) -> int:
    """Return the singleton organization id, seeding it + roles once.

    Single-organization installation: exactly one ``Organization`` row may
    ever exist. Repeated bootstrap calls return the same row.
    """
    row = fetch_one(session, "SELECT OrganizationID FROM Organization ORDER BY OrganizationID")
    if row:
        organization_id = int(row["OrganizationID"])
        # Identity upgrade: an installation still carrying a *seeded* legacy
        # brand follows the shipped palette. A colour an admin chose on purpose
        # is never touched — only the exact previous defaults are rewritten.
        upgraded = update_rows(
            session,
            Organization,
            {"BrandPrimaryColor": primary_color},
            [Organization.OrganizationID == organization_id, Organization.BrandPrimaryColor.in_(LEGACY_BRAND_PRIMARY)],
        )
        if upgraded:
            logger.info("Organization brand upgraded to %s (id=%s)", primary_color, organization_id)
    else:
        organization_id = insert_row(
            session,
            Organization,
            {
                "Name": name,
                "CompanyName": company_name or name,
                "BrandPrimaryColor": primary_color,
                "BrandAccentColor": accent_color,
                "PlatformProvider": provider,
                "Locale": locale,
                "IsActive": True,
            },
        )
        logger.info("Organization created: %s (id=%s)", name, organization_id)

    seeded = fetch_scalar(session, "SELECT COUNT(1) AS c FROM RolePermissions", {}, default=0)
    if not seeded:
        for role, permissions in ROLE_PERMISSIONS.items():
            for permission in permissions:
                insert_row(session, RolePermissions, {"Role": role, "Permission": permission})
    return organization_id


def ensure_admin_user(
    session: Session,
    *,
    username: str,
    password: str,
    role: str = "SuperAdmin",
    email: Optional[str] = None,
) -> Optional[int]:
    """Create the bootstrap administrator if the username is free."""
    existing = fetch_one(
        session,
        "SELECT UserID FROM SystemUsers WHERE Username = :u",
        {"u": username},
    )
    if existing:
        return int(existing["UserID"])

    policy = check_password_policy(password)
    if not policy.ok:
        logger.warning("Bootstrap admin password rejected by policy: %s", policy.message)
        return None

    user_id = insert_row(
        session,
        SystemUsers,
        {
            "Username": username,
            "Email": email,
            "FullName": username,
            "PasswordHash": hash_password(password),
            "Role": role,
            "AllowedDepartment": "ALL",
            "IsActive": True,
            "FailedLoginAttempts": 0,
        },
    )
    logger.info("Bootstrap admin '%s' created (id=%s)", username, user_id)
    return user_id


# --------------------------------------------------------------------------- #
# Demo dataset
# --------------------------------------------------------------------------- #
DEMO_PROCESSES = [
    ("Invoice_Processing", "Finance", "Bot-01", 5.0, 12.0, 0.9, 30, 80, "High"),
    ("KYC_Check", "Operations", "Bot-02", 9.0, 18.0, 1.4, 45, 60, "High"),
    ("Loan_Disbursement", "IT", "Bot-03", 14.0, 26.0, 2.1, 90, 25, "Critical"),
    ("credit_card_linkage", "Finance", "Bot-01", 4.0, 9.5, 0.7, 20, 120, "Medium"),
    ("Statement_Generation", "Operations", "Bot-04", 7.5, 15.0, 1.1, 60, 40, "Medium"),
    ("Fraud_Alert_Triage", "Risk", "Bot-05", 11.0, 22.0, 1.8, 35, 55, "Critical"),
]


def seed_demo_data(session: Session, *, days: int = 30, seed: int = 1337) -> Dict[str, int]:
    """Populate a realistic demo dataset (processes, runs, queues, machines).

    Idempotent: skips seeding when process rows already exist.
    """
    existing = fetch_scalar(
        session, "SELECT COUNT(1) AS c FROM ProcessConfig WHERE 1 = 1", {}, default=0
    )
    if int(existing or 0) > 0:
        return {"processes": 0, "runs": 0, "machines": 0}

    rng = random.Random(seed)
    now = datetime.utcnow()
    counts = {"processes": 0, "runs": 0, "machines": 0}

    for name, dept, _bot, emp_minutes, emp_cost, bot_cost, sla, expected_runs, criticality in DEMO_PROCESSES:
        insert_row(
            session,
            ProcessConfig,
            {
                "ProcessName": name,
                "Department": dept,
                "BotName": _bot,
                "Provider": "generic_sql",
                "ExpectedRunsPerDay": expected_runs,
                "EmpMinutesPerRequest": emp_minutes,
                "EmpCostPerRequest": emp_cost,
                "BotCostPerRequest": bot_cost,
                "SLATargetMinutes": sla,
                "Criticality": criticality,
                "IsActive": True,
                "Notes": f"Demo process for {dept}",
            },
        )
        counts["processes"] += 1

        pending = rng.choice([0, 4, 12, 35, 60, 140])
        insert_row(
            session,
            ProcessQueues,
            {
                "ProcessName": name,
                "PendingItems": pending,
                "ActiveItems": rng.choice([0, 1, 2, 3]),
                "AvgItemProcessingSeconds": rng.choice([12, 25, 40, 55]),
                "LastUpdatedAt": now,
            },
        )

        for day_offset in range(days, -1, -1):
            day_date = now - timedelta(days=day_offset)
            if day_date.weekday() >= 5 and rng.random() < 0.6:
                continue
            runs_today = max(0, int(expected_runs * rng.uniform(0.55, 1.25) / 6))
            for index in range(runs_today):
                start = day_date.replace(
                    hour=rng.randint(7, 20), minute=rng.randint(0, 59), second=rng.randint(0, 59), microsecond=0
                )
                roll = rng.random()
                if roll < 0.86:
                    status, txn = "Completed", rng.randint(1, 60)
                elif roll < 0.94:
                    status, txn = "Failed", 0
                elif roll < 0.97:
                    status, txn = "Stopped", rng.randint(0, 3)
                else:
                    status, txn = "Running", 0

                duration = round(rng.uniform(1.5, 22.0), 2) if status != "Running" else None
                end = start + timedelta(minutes=duration) if duration else None
                reason = None
                if status in ("Failed", "Stopped"):
                    reason = rng.choice(
                        [
                            "Timeout while connecting to core banking",
                            "Invalid account number format",
                            "Manual intervention required",
                            "Selector not found: InvoiceGrid",
                            "Database deadlock on sp_UpdateCustomer",
                            "Credential expired for SAP login",
                        ]
                    )
                insert_row(
                    session,
                    ProcessRuns,
                    {
                        "ProcessName": name,
                        "RequestID": f"{name[:3].upper()}-{day_date:%Y%m%d}-{index:04d}",
                        "Status": status,
                        "StartTime": start,
                        "EndTime": end,
                        "DurationMinutes": duration,
                        "FailureReason": reason,
                        "TransactionsCount": txn,
                        "SuccessCount": txn,
                        "FailedCount": 0 if status == "Completed" else rng.randint(0, 2),
                        "TimeSavedHours": round(txn * float(emp_minutes) / 60.0, 2),
                        "CostSaved": round(txn * (float(emp_cost) - float(bot_cost)), 2),
                        "MachineName": _bot,
                        "Provider": "generic_sql",
                        "Trigger": "schedule",
                        "IdempotencyKey": f"demo-{name}-{day_date:%Y%m%d}-{index}",
                    },
                )
                counts["runs"] += 1

    machines = [
        ("Bot-01", "Invoice_Processing", "Unattended", 32, 512, "Windows", "Healthy"),
        ("Bot-02", "KYC_Check", "Unattended", 16, 256, "Windows", "Healthy"),
        ("Bot-03", "Loan_Disbursement", "Unattended", 32, 512, "Windows", "Healthy"),
        ("Bot-04", "Statement_Generation", "Unattended", 16, 256, "Windows", "Healthy"),
        ("Bot-05", "Fraud_Alert_Triage", "Attended", 8, 128, "Windows", "Healthy"),
        ("Bot-06", None, "TestBot", 8, 128, "Linux", "Offline"),
    ]
    for machine_name, assigned, runner_type, ram, hdd, os_name, status in machines:
        # Machines belonging to the demo run either recently (online) or days ago (offline)
        last_ping = now - timedelta(minutes=rng.randint(1, 4)) if status == "Healthy" else now - timedelta(days=3)
        insert_row(
            session,
            BotInfrastructure,
            {
                "MachineName": machine_name,
                "AssignedProcess": assigned,
                "Status": "Online" if status == "Healthy" else "Offline",
                "CPU_Usage": rng.randint(12, 96) if status == "Healthy" else 0,
                "RAM_Usage": rng.randint(20, 88) if status == "Healthy" else 0,
                "HDD_Usage": rng.randint(30, 82) if status == "Healthy" else 0,
                "LastPing": last_ping,
                "TotalRAM_GB": ram,
                "TotalHDD_GB": hdd,
                "RunnerType": runner_type,
                "Platform": "generic_sql",
                "OSName": os_name,
                "AgentVersion": "4.1.0",
                "LastIP": f"10.20.{rng.randint(1, 9)}.{rng.randint(10, 250)}",
            },
        )
        counts["machines"] += 1

    # A couple of lifecycle versions so the Lifecycle view is not empty
    for version_tag, process, status in (
        ("v1.0.0", "Invoice_Processing", "Production"),
        ("v1.1.0", "Invoice_Processing", "UAT"),
        ("v1.2.0", "Invoice_Processing", "Development"),
        ("v2.0.0", "KYC_Check", "Production"),
        ("v1.0.0", "Loan_Disbursement", "Development"),
    ):
        insert_row(
            session,
            BotVersions,
            {
                "ProcessName": process,
                "VersionTag": version_tag,
                "CurrentStatus": status,
                "Notes": "Demo release",
                "CreatedAt": now - timedelta(days=rng.randint(1, 60)),
            },
        )

    logger.info("Demo data seeded: %s", counts)
    return counts


def bootstrap_database(
    *, create_demo: bool = False, admin_username: Optional[str] = None, admin_password: Optional[str] = None
) -> Dict[str, Any]:
    """Full bootstrap used by CLI, tests and first-run installs."""
    settings = get_settings()
    create_schema()

    summary: Dict[str, Any] = {"dialect": settings.DB_DIALECT, "tables": len(metadata.tables)}
    with session_scope() as session:
        organization_id = ensure_organization(session, name="FGS Solutions", company_name="FGS Solutions")
        summary["organization_id"] = organization_id

        username = admin_username or os.environ.get("BOOTSTRAP_ADMIN_USERNAME", "admin")
        password = admin_password or os.environ.get("BOOTSTRAP_ADMIN_PASSWORD", "ChangeMe_Admin1!")
        admin_id = ensure_admin_user(session, username=username, password=password, role="SuperAdmin")
        summary["admin_username"] = username if admin_id else None

        if create_demo:
            summary.update(seed_demo_data(session))

    record_schema_version()
    return summary


def schema_report() -> Dict[str, Any]:
    """Return which canonical tables exist (used by ``/health/detail``)."""
    engine = get_engine()
    inspector = inspect(engine)
    existing = set(inspector.get_table_names())
    expected = set(metadata.tables.keys())
    return {
        "dialect": get_settings().DB_DIALECT,
        "expected": len(expected),
        "existing": len(existing & expected),
        "missing": sorted(expected - existing),
    }


def main() -> None:
    """CLI entry point: ``python -m app.db.bootstrap --seed-demo``."""
    parser = argparse.ArgumentParser(description="Bootstrap the RPA CoE database")
    parser.add_argument("--seed-demo", action="store_true", help="insert demo processes/runs/machines")
    parser.add_argument("--admin-username", default=None, help="bootstrap admin username")
    parser.add_argument("--admin-password", default=None, help="bootstrap admin password")
    parser.add_argument("--drop", action="store_true", help="drop all tables first (dev only!)")
    args = parser.parse_args()

    logging.basicConfig(level="INFO", format="%(levelname)s %(name)s: %(message)s")
    settings = get_settings()
    if settings.is_prod and args.drop:
        raise SystemExit("Refusing to drop tables in production")

    if args.drop:
        metadata.drop_all(get_engine())
        print("All tables dropped.")

    summary = bootstrap_database(create_demo=args.seed_demo, admin_username=args.admin_username, admin_password=args.admin_password)
    print("Bootstrap complete:")
    for key, value in summary.items():
        print(f"  - {key}: {value}")
    dispose_engine()


if __name__ == "__main__":  # pragma: no cover - CLI
    main()
