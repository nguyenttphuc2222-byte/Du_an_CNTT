from sqlalchemy.orm import Session

from app.db.session import Base, SessionLocal, engine
from app.models.user import User
from pwdlib import PasswordHash

DEMO_USERNAME = "student1"
DEMO_PASSWORD = "Student@123"

password_hash = PasswordHash.recommended()


def main():
    Base.metadata.create_all(bind=engine)
    db: Session = SessionLocal()
    try:
        user = db.query(User).filter(User.username == DEMO_USERNAME).first()
        if user:
            print(f"User '{DEMO_USERNAME}' already exists; no changes made.")
            return

        user = User(
            username=DEMO_USERNAME,
            email="student1@example.local",
            full_name="Sinh viên thử nghiệm",
            password_hash=password_hash.hash(DEMO_PASSWORD),
            role="student",
            is_active=True,
        )
        db.add(user)
        db.commit()
        print("Created demo user.")
        print(f"Username: {DEMO_USERNAME}")
        print(f"Password: {DEMO_PASSWORD}")
        print("This is for local testing only. Change it before deployment.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
