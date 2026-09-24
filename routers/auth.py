from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from pydantic import BaseModel
from datetime import datetime, timedelta
from jose import JWTError, jwt
from passlib.context import CryptContext
from typing import Optional
from db_connection import run_query, execute_update

SECRET_KEY = "FGS_ENTERPRISE_SECRET_KEY_2026"
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 120

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


def verify_password(plain_password, hashed_password):
    return pwd_context.verify(plain_password, hashed_password)


def get_password_hash(password):
    return pwd_context.hash(password[:72])  # لتجنب مشاكل طول كلمة المرور في bcrypt


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None):
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=15)
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


async def get_current_user(token: str = Depends(oauth2_scheme)):
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="بيانات الاعتماد غير صالحة",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        if username is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception

    # استخدام AllowedDepartment بدلاً من AllowedBusinessUnit
    user_df = run_query(
        f"SELECT UserID, Username, Role, AllowedDepartment FROM SystemUsers WHERE Username = '{username}'")
    if user_df.empty:
        raise credentials_exception

    user_data = user_df.iloc[0]
    return User(
        UserID=int(user_data['UserID']),
        Username=user_data['Username'],
        Role=user_data['Role'],
        AllowedDepartment=user_data['AllowedDepartment'] if user_data['AllowedDepartment'] else 'ALL'
    )


@router.post("/login", response_model=Token)
def login(form_data: OAuth2PasswordRequestForm = Depends()):
    user_df = run_query(f"SELECT * FROM SystemUsers WHERE Username = '{form_data.username}'")

    if user_df.empty or not verify_password(form_data.password, user_df.iloc[0]['PasswordHash']):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="اسم المستخدم أو كلمة المرور غير صحيحة",
            headers={"WWW-Authenticate": "Bearer"},
        )

    user = user_df.iloc[0]
    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={"sub": user['Username'], "role": user['Role']},
        expires_delta=access_token_expires
    )

    return {
        "access_token": access_token,
        "token_type": "bearer",
        "role": user['Role'],
        "username": user['Username']
    }


class NewUser(BaseModel):
    username: str
    password: str
    role: str
    department: Optional[str] = "ALL"


@router.post("/create-admin")
def create_admin(user: NewUser):
    hashed_pw = get_password_hash(user.password)
    query = f"""
    INSERT INTO SystemUsers (Username, PasswordHash, Role, AllowedDepartment)
    VALUES ('{user.username}', '{hashed_pw}', '{user.role}', '{user.department}')
    """
    execute_update(query)
    return {"message": "User created successfully"}