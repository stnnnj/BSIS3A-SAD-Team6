
import getpass
import pymysql

from werkzeug.security import generate_password_hash
from db import get_db_connection


def create_user():
    print("\n===================================")
    print("CCMC RetailFlow - Create User")
    print("===================================")

    name = input("Enter full name: ").strip()
    username = input("Enter username: ").strip()

    print("\nSelect account role:")
    print("1. Owner")
    print("2. Staff")

    role_choice = input("Enter choice (1 or 2): ").strip()

    if role_choice == "1":
        role = "Owner"
    elif role_choice == "2":
        role = "Staff"
    else:
        print("Invalid role selected.")
        return

    if not name or not username:
        print("Name and username cannot be empty.")
        return

    password = getpass.getpass("Enter password: ")
    confirm_password = getpass.getpass("Confirm password: ")

    if password != confirm_password:
        print("Passwords do not match.")
        return

    if len(password) < 12:
        print("Password must be at least 12 characters.")
        return

    hashed_password = generate_password_hash(
        password,
        method="scrypt"
    )

    connection = None

    try:
        connection = get_db_connection()

        with connection.cursor() as cursor:

            # Check for an existing username
            cursor.execute(
                "SELECT user_id FROM users WHERE username = %s",
                (username,)
            )

            if cursor.fetchone():
                print("Username already exists.")
                return

            # Insert the new account
            cursor.execute(
                """
                INSERT INTO users
                    (name, username, password, role, is_active)
                VALUES
                    (%s, %s, %s, %s, %s)
                """,
                (
                    name,
                    username,
                    hashed_password,
                    role,
                    1
                )
            )

            connection.commit()

            print("\nAccount created successfully!")
            print("Name:", name)
            print("Username:", username)
            print("Role:", role)
            print("Status: Active")

    except pymysql.err.IntegrityError:
        if connection:
            connection.rollback()
        print("Account creation failed: username already exists.")

    except Exception as error:
        if connection:
            connection.rollback()
        print("Account creation failed.")
        print("Database error:", type(error).__name__)

    finally:
        if connection:
            connection.close()


if __name__ == "__main__":
    create_user()
