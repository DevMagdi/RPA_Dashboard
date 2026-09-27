import os
from datetime import datetime, timedelta
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, status, Request
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from jose import JWTError, jwt
from passlib.context import CryptContext
from pydantic import BaseModel, Field

from db_connection import run_query, execute_update
from slowapi import Limiter
from slowapi.util import get_remote_address
limiter = Limiter(key_func=get_remote_address)

SECRET_KEY = os.environ["JWT_SECRET_KEY"]
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.environ.get("ACCESS_TOKEN_EXPIRE_MINUTES", 60))

# Enterprise security settings
MAX_FAILED_LOGIN_ATTEMPTS = int(os.environ.get("MAX_FAILED_LOGIN_ATTEMPTS", 5))
LOCKOUT_MINUTES = int(os.environ.get("LOCKOUT_MINUTES", 15))

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="api/auth/login")

router = APIRouter(prefix="/api/auth", tags=["Authentication"])


class Token(BaseModel):
    access_token: str
    token_type: str
    role: str
    username: str


class User(BaseModel):
    UserID: int
    Username: str
    Role: str
    AllowedDepartment: str


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


def get_password_hash(pw: str) -> str:
    # bcrypt limitation
    return pwd_context.hash(pw[:72])


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    to_encode = data.copy()
    to_encode.update({"exp": datetime.utcnow() + (expires_delta or timedelta(minutes=15))})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def _audit_auth_event(
    *,
    user_id: Optional[int],
    action_type: str,
    username: str,
    ip: Optional[str],
    is_success: bool,
    details: Optional[dict] = None,
):
    # ملاحظة: ProcessName = NULL عشان دي Auth logs مش Process logs
    execute_update(
        """
        INSERT INTO AuditLogs (UserID, ActionType, ProcessName, OldValues, NewValues, IPAddress, IsSuccess)
        VALUES (:uid, :action, NULL, NULL, :newv, :ip, :ok)
        """,
        {
            "uid": user_id,
            "action": action_type,
            "newv": (None if details is None else __import__("json").dumps(details, default=str)),
            "ip": ip,
            "ok": 1 if is_success else 0,
        },
    )


async def get_current_user(token: str = Depends(oauth2_scheme)) -> User:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="بيانات الاعتماد غير صالحة",
        headers={"WWW-Authenticate": "Bearer"},
    )

    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username = payload.get("sub")
        if not username:
            raise credentials_exception
    except JWTError:
        raise credentials_exception

    user_df = run_query(
        """
        SELECT UserID, Username, Role, AllowedDepartment, IsActive, FailedLoginAttempts, LockedUntil
        FROM SystemUsers
        WHERE Username = :u
        """,
        {"u": username},
    )
    if user_df.empty:
        raise credentials_exception

    u = user_df.iloc[0]

    if "IsActive" in u and not bool(u["IsActive"]):
        raise HTTPException(status_code=403, detail="هذا الحساب معطل")

    # Lockout check
    locked_until = u.get("LockedUntil", None)
    try:
        if locked_until is not None and str(locked_until) != "NaT":
            locked_until_dt = datetime.fromisoformat(str(locked_until).replace(" ", "T"))
            if locked_until_dt > datetime.now():
                raise HTTPException(status_code=403, detail="تم قفل الحساب مؤقتاً بسبب محاولات دخول فاشلة")
    except HTTPException:
        raise
    except Exception:
        # لو parsing فشل، نتجاهل
        pass

    return User(
        UserID=int(u["UserID"]),
        Username=str(u["Username"]),
        Role=str(u["Role"]),
        AllowedDepartment=str(u["AllowedDepartment"] or "ALL"),
    )


def require_roles(*roles):
    def checker(current_user: User = Depends(get_current_user)):
        if current_user.Role not in roles:
            raise HTTPException(status_code=403, detail="ليس لديك صلاحية للقيام بهذا الإجراء")
        return current_user
    return checker


@router.post("/login", response_model=Token)
@limiter.limit("5/minute")
def login(form_data: OAuth2PasswordRequestForm = Depends(), request: Request = None):
    ip = request.client.host if request and request.client else None

    generic_error = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="اسم المستخدم أو كلمة المرور غير صحيحة",
        headers={"WWW-Authenticate": "Bearer"},
    )

    user_df = run_query(
        """
        SELECT UserID, Username, PasswordHash, Role, AllowedDepartment, IsActive,
               FailedLoginAttempts, LockedUntil
        FROM SystemUsers
        WHERE Username = :u
        """,
        {"u": form_data.username},
    )
    if user_df.empty:
        # لا نكشف إن اليوزر غير موجود
        _audit_auth_event(
            user_id=None,
            action_type="Login_Failed",
            username=form_data.username,
            ip=ip,
            is_success=False,
            details={"reason": "user_not_found"},
        )
        raise generic_error

    user = user_df.iloc[0]
    user_id = int(user["UserID"])

    if "IsActive" in user and not bool(user["IsActive"]):
        _audit_auth_event(
            user_id=user_id,
            action_type="Login_Failed",
            username=form_data.username,
            ip=ip,
            is_success=False,
            details={"reason": "inactive_account"},
        )
        raise HTTPException(status_code=403, detail="هذا الحساب معطل")

    # Lockout check (server side)
    locked_until = user.get("LockedUntil", None)
    try:
        if locked_until is not None and str(locked_until) != "NaT":
            locked_until_dt = datetime.fromisoformat(str(locked_until).replace(" ", "T"))
            if locked_until_dt > datetime.now():
                _audit_auth_event(
                    user_id=user_id,
                    action_type="Login_Failed",
                    username=form_data.username,
                    ip=ip,
                    is_success=False,
                    details={"reason": "locked_until", "locked_until": str(locked_until)},
                )
                raise HTTPException(status_code=403, detail="تم قفل الحساب مؤقتاً بسبب محاولات دخول فاشلة")
    except HTTPException:
        raise
    except Exception:
        pass

    # Password verify
    if not verify_password(form_data.password, user["PasswordHash"]):
        # increment failed attempts
        execute_update(
            """
            UPDATE SystemUsers
            SET FailedLoginAttempts = ISNULL(FailedLoginAttempts,0) + 1
            WHERE UserID = :id
            """,
            {"id": user_id},
        )

        # get updated value
        tries_df = run_query("SELECT FailedLoginAttempts FROM SystemUsers WHERE UserID = :id", {"id": user_id})
        tries = int(tries_df.iloc[0]["FailedLoginAttempts"]) if not tries_df.empty else 0

        # lock if reached threshold
        if tries >= MAX_FAILED_LOGIN_ATTEMPTS:
            execute_update(
                """
                UPDATE SystemUsers
                SET LockedUntil = DATEADD(minute, :mins, GETDATE())
                WHERE UserID = :id
                """,
                {"id": user_id, "mins": LOCKOUT_MINUTES},
            )
            _audit_auth_event(
                user_id=user_id,
                action_type="Login_Locked",
                username=form_data.username,
                ip=ip,
                is_success=False,
                details={"failed_attempts": tries, "lock_minutes": LOCKOUT_MINUTES},
            )
            raise HTTPException(status_code=403, detail="تم قفل الحساب مؤقتاً بسبب محاولات دخول فاشلة")

        _audit_auth_event(
            user_id=user_id,
            action_type="Login_Failed",
            username=form_data.username,
            ip=ip,
            is_success=False,
            details={"reason": "wrong_password", "failed_attempts": tries},
        )
        raise generic_error

    # success: reset attempts + unlock + update last login
    execute_update(
        """
        UPDATE SystemUsers
        SET FailedLoginAttempts = 0,
            LockedUntil = NULL,
            LastLoginDate = GETDATE()
        WHERE UserID = :id
        """,
        {"id": user_id},
    )

    token = create_access_token(
        {"sub": user["Username"], "role": user["Role"]},
        timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES),
    )

    _audit_auth_event(
        user_id=user_id,
        action_type="Login_Success",
        username=form_data.username,
        ip=ip,
        is_success=True,
        details={"role": user["Role"]},
    )

    return {
        "access_token": token,
        "token_type": "bearer",
        "role": user["Role"],
        "username": user["Username"],
    }


class NewUser(BaseModel):
    username: str = Field(..., min_length=3, max_length=50)
    password: str = Field(..., min_length=8)
    role: str
    department: Optional[str] = "ALL"


@router.post("/create-admin")
def create_admin(user: NewUser, request: Request, current_user: User = Depends(require_roles("SuperAdmin"))):
    ip = request.client.host if request and request.client else None

    existing = run_query("SELECT UserID FROM SystemUsers WHERE Username = :u", {"u": user.username})
    if not existing.empty:
        raise HTTPException(status_code=400, detail="اسم المستخدم مستخدم بالفعل")

    execute_update(
        """
        INSERT INTO SystemUsers (Username, PasswordHash, Role, AllowedDepartment, IsActive, FailedLoginAttempts)
        VALUES (:username, :pw, :role, :dept, 1, 0)
        """,
        {
            "username": user.username,
            "pw": get_password_hash(user.password),
            "role": user.role,
            "dept": user.department,
        },
    )

    # Audit
    _audit_auth_event(
        user_id=current_user.UserID,
        action_type="Create_User",
        username=current_user.Username,
        ip=ip,
        is_success=True,
        details={"created_username": user.username, "role": user.role, "department": user.department},
    )

    return {"message": "User created successfully"}