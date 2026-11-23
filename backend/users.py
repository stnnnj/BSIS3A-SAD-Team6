
"""
CCMC RetailFlow - User Accounts Management

GET  /api/users
POST /api/users
PUT  /api/users/<user_id>

Owner-only access.
Uses the existing TiDB Cloud database.
"""

import re

from functools import wraps

from flask import (
    Blueprint,
    current_app,
    jsonify,
    request,
    session
)

from werkzeug.security import generate_password_hash
from pymysql.err import IntegrityError

from db import get_db_connection


# ==========================================
# 1. BLUEPRINT CONFIGURATION
# ==========================================

users_bp = Blueprint("users", __name__)

ALLOWED_ROLES = ("Owner", "Staff")


# ==========================================
# 2. RESPONSE HELPERS
# ==========================================

def success_response(message, data=None, status=200):

    response = {
        "success": True,
        "message": message
    }

    if data is not None:
        response["data"] = data

    return jsonify(response), status


def error_response(message, status=400):

    return jsonify({
        "success": False,
        "message": message
    }), status


# ==========================================
# 3. OWNER AUTHORIZATION AND DATABASE
# ==========================================

def owner_required(function):

    @wraps(function)
    def wrapper(*args, **kwargs):

        user_id = session.get("user_id")

        if not user_id:
            return error_response(
                "Authentication required.", 401
            )

        if session.get("role") != "Owner":
            return error_response(
                "Owner access required.", 403
            )

        is_write = request.method in (
            "POST", "PUT", "PATCH", "DELETE"
        )

        # Trusted-origin protection for account changes.
        # Includes the deployed Netlify frontend.
        if is_write:

            trusted_origins = (
                request.host_url.rstrip("/"),
                "https://ccmc-retailflow.netlify.app"
            )

            if request.headers.get("Origin") not in trusted_origins:

                return error_response(
                    "Invalid request origin.", 403
                )

            if not request.is_json:

                return error_response(
                    "JSON request required.", 415
                )

        connection = None

        try:

            connection = get_db_connection()

            with connection.cursor() as cursor:

                cursor.execute(
                    "SET time_zone = '+08:00'"
                )

                # Prevent conflicting account
                # updates during write operations.
                if is_write:
                    cursor.execute("BEGIN PESSIMISTIC")

                    cursor.execute("""
                        SELECT user_id, role, is_active
                        FROM users
                        WHERE user_id = %s
                        FOR UPDATE
                    """, (user_id,))

                else:

                    cursor.execute("""
                        SELECT user_id, role, is_active
                        FROM users
                        WHERE user_id = %s
                    """, (user_id,))

                actor = cursor.fetchone()

                # Verify the current database account,
                # not only the stored session.
                if (
                    not actor or
                    int(actor["is_active"]) != 1
                ):

                    session.clear()

                    return error_response(
                        "Your account is inactive or unavailable.",
                        401
                    )

                if actor["role"] != "Owner":

                    session.clear()

                    return error_response(
                        "Your account permissions have changed.",
                        401
                    )

                response, status = function(
                    cursor,
                    actor,
                    *args,
                    **kwargs
                )

                if is_write:

                    if status < 400:
                        connection.commit()
                    else:
                        connection.rollback()

                return response, status

        except IntegrityError as error:

            if connection:
                connection.rollback()

            # Duplicate username
            if error.args and error.args[0] == 1062:

                return error_response(
                    "Username already exists.", 409
                )

            current_app.logger.exception(
                "User account integrity error"
            )

            return error_response(
                "Unable to save user account.", 500
            )

        except Exception:

            if connection:
                connection.rollback()

            current_app.logger.exception(
                "User Accounts operation failed"
            )

            return error_response(
                "Unable to process account request.", 500
            )

        finally:

            if connection:
                connection.close()

    return wrapper


# ==========================================
# 4. USER DATA VALIDATION
# ==========================================

def validate_user(data, is_new_user=False):

    if not isinstance(data, dict):
        return "Invalid request data."

    name = data.get("name")
    username = data.get("username")
    role = data.get("role")
    is_active = data.get("is_active")

    if (
        not isinstance(name, str) or
        not name.strip() or
        len(name.strip()) > 100
    ):
        return "Enter a valid full name."

    if (
        not isinstance(username, str) or
        not username.strip() or
        len(username.strip()) > 50
    ):
        return "Enter a valid username."

    if not re.fullmatch(
        r"[a-zA-Z0-9._-]+",
        username.strip()
    ):
        return (
            "Username may only contain letters, "
            "numbers, periods, underscores, "
            "and hyphens."
        )

    if role not in ALLOWED_ROLES:
        return "Invalid account role."

    if type(is_active) is not int or is_active not in (0, 1):
        return "Invalid account status."

    # Password is required for new accounts.
    # Password reset is optional for existing accounts.

    password_field = (
        "password" if is_new_user
        else "new_password"
    )

    if is_new_user or password_field in data:

        password = data.get(password_field)

        if (
            not isinstance(password, str) or
            len(password) < 8 or
            len(password) > 128 or
            not password.strip()
        ):

            return (
                "Password must contain "
                "8 to 128 characters."
            )

    return None


# ==========================================
# 5. GET ALL USER ACCOUNTS
# ==========================================

@users_bp.route("/api/users", methods=["GET"])
@owner_required
def get_users(cursor, actor):

    cursor.execute("""
        SELECT
            user_id,
            name,
            username,
            role,
            is_active,
            created_at
        FROM users
        ORDER BY user_id ASC
    """)

    records = cursor.fetchall()

    users = []

    for row in records:

        created_at = row["created_at"]

        users.append({

            "user_id": row["user_id"],

            "name": row["name"],

            "username": row["username"],

            "role": row["role"],

            "is_active": int(row["is_active"]),

            "created_at": (
                created_at.isoformat()
                if created_at else None
            )

        })

    return success_response(
        "User accounts retrieved successfully.",
        {"users": users}
    )


# ==========================================
# 6. CREATE NEW USER ACCOUNT
# ==========================================

@users_bp.route("/api/users", methods=["POST"])
@owner_required
def create_user(cursor, actor):

    data = request.get_json(silent=True)

    validation_error = validate_user(
        data,
        is_new_user=True
    )

    if validation_error:

        return error_response(
            validation_error, 400
        )

    name = data["name"].strip()
    username = data["username"].strip()
    password = data["password"]
    role = data["role"]
    is_active = data["is_active"]

    # Check existing username.
    cursor.execute("""
        SELECT user_id
        FROM users
        WHERE username = %s
        LIMIT 1
    """, (username,))

    if cursor.fetchone():

        return error_response(
            "Username already exists.", 409
        )

    # Secure password hashing.
    password_hash = generate_password_hash(
        password,
        method="scrypt"
    )

    # Save new account.
    cursor.execute("""
        INSERT INTO users (
            name,
            username,
            password,
            role,
            is_active,
            created_at
        )
        VALUES (
            %s, %s, %s, %s, %s,
            CURRENT_TIMESTAMP
        )
    """, (
        name,
        username,
        password_hash,
        role,
        is_active
    ))

    new_user_id = cursor.lastrowid

    return success_response(

        "User account created successfully.",

        {
            "user_id": new_user_id,
            "name": name,
            "username": username,
            "role": role,
            "is_active": is_active
        },

        201

    )


# ==========================================
# 7. UPDATE EXISTING USER ACCOUNT
# ==========================================

@users_bp.route(
    "/api/users/<int:user_id>",
    methods=["PUT"]
)
@owner_required
def update_user(cursor, actor, user_id):

    data = request.get_json(silent=True)

    validation_error = validate_user(
        data,
        is_new_user=False
    )

    if validation_error:

        return error_response(
            validation_error, 400
        )

    name = data["name"].strip()
    username = data["username"].strip()
    role = data["role"]
    is_active = data["is_active"]

    new_password = data.get("new_password")


    # ======================================
    # FIND EXISTING ACCOUNT
    # ======================================

    cursor.execute("""
        SELECT
            user_id,
            name,
            username,
            role,
            is_active
        FROM users
        WHERE user_id = %s
        FOR UPDATE
    """, (user_id,))

    existing_user = cursor.fetchone()

    if not existing_user:

        return error_response(
            "User account not found.", 404
        )


    # ======================================
    # PREVENT OWNER SELF-LOCKOUT
    # ======================================

    if int(user_id) == int(actor["user_id"]):

        if is_active == 0:

            return error_response(
                "You cannot deactivate your own account.",
                400
            )

        if role != "Owner":

            return error_response(
                "You cannot remove your own Owner role.",
                400
            )


    # ======================================
    # CHECK FOR DUPLICATE USERNAME
    # ======================================

    cursor.execute("""
        SELECT user_id
        FROM users
        WHERE username = %s
          AND user_id != %s
        LIMIT 1
    """, (
        username,
        user_id
    ))

    if cursor.fetchone():

        return error_response(
            "Username already exists.", 409
        )


    # ======================================
    # UPDATE WITH PASSWORD RESET
    # ======================================

    if new_password is not None:

        password_hash = generate_password_hash(
            new_password,
            method="scrypt"
        )

        cursor.execute("""
            UPDATE users
            SET
                name = %s,
                username = %s,
                password = %s,
                role = %s,
                is_active = %s
            WHERE user_id = %s
        """, (
            name,
            username,
            password_hash,
            role,
            is_active,
            user_id
        ))


    # ======================================
    # UPDATE WITHOUT PASSWORD RESET
    # ======================================

    else:

        cursor.execute("""
            UPDATE users
            SET
                name = %s,
                username = %s,
                role = %s,
                is_active = %s
            WHERE user_id = %s
        """, (
            name,
            username,
            role,
            is_active,
            user_id
        ))

    return success_response(

        "User account updated successfully.",

        {
            "user_id": user_id,
            "name": name,
            "username": username,
            "role": role,
            "is_active": is_active
        }

    )
