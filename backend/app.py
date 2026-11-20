
import os
from datetime import timedelta
from functools import wraps
from pathlib import Path

from flask import (
    Flask,
    jsonify,
    request,
    session,
    send_from_directory,
    redirect
)

from dotenv import load_dotenv
from werkzeug.security import check_password_hash

from db import get_db_connection


# ==========================================
# ENVIRONMENT CONFIGURATION
# ==========================================

BASE_DIR = Path(__file__).resolve().parent.parent

load_dotenv(BASE_DIR / ".env")

app = Flask(__name__)

secret_key = os.getenv("FLASK_SECRET_KEY")

if not secret_key or len(secret_key) < 32:
    raise RuntimeError(
        "FLASK_SECRET_KEY is missing or too short."
    )

app.config.update(
    SECRET_KEY=secret_key,
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_SECURE=False,  # Local development only
    PERMANENT_SESSION_LIFETIME=timedelta(hours=8),
)


# ==========================================
# BASIC ROUTES
# ==========================================

@app.get("/")
def home():
    return jsonify({
        "system": "CCMC RetailFlow",
        "message": "Backend is running successfully."
    })


@app.get("/api/health")
def health():
    return jsonify({
        "status": "ok",
        "message": "Flask API is working"
    })


# ==========================================
# FRONTEND ROUTES
# STEP 8.6 – FRONTEND INTEGRATION
# ==========================================

FRONTEND_DIR = BASE_DIR / "frontend"



# ==========================================
# STEP 8.9.1 – PROTECTED FRONTEND ROUTES
# ==========================================

FRONTEND_DIR = BASE_DIR / "frontend"


@app.get("/frontend/<path:filename>")
def frontend_files(filename):

    # Owner dashboard: Owner access only
    if filename == "owner-dashboard.html":

        if "user_id" not in session:
            return redirect("/frontend/index.html")

        if session.get("role") != "Owner":
            return redirect("/frontend/staff-dashboard.html")

    # Staff dashboard: Staff access only
    if filename == "staff-dashboard.html":

        if "user_id" not in session:
            return redirect("/frontend/index.html")

        if session.get("role") != "Staff":
            if session.get("role") == "Owner":
                return redirect("/frontend/owner-dashboard.html")

            return redirect("/frontend/index.html")

    return send_from_directory(FRONTEND_DIR, filename)


# ==========================================
# AUTHENTICATION HELPERS
# ==========================================

def login_required(function):

    @wraps(function)
    def wrapper(*args, **kwargs):

        if "user_id" not in session:
            return jsonify({
                "success": False,
                "message": "Authentication required."
            }), 401

        return function(*args, **kwargs)

    return wrapper


def owner_required(function):

    @wraps(function)
    def wrapper(*args, **kwargs):

        if "user_id" not in session:
            return jsonify({
                "success": False,
                "message": "Authentication required."
            }), 401

        if session.get("role") != "Owner":
            return jsonify({
                "success": False,
                "message": "Owner access required."
            }), 403

        return function(*args, **kwargs)

    return wrapper


# ==========================================
# LOGIN API
# POST /api/auth/login
# ==========================================

@app.post("/api/auth/login")
def login():

    data = request.get_json(silent=True)

    if not isinstance(data, dict):
        return jsonify({
            "success": False,
            "message": "JSON request body required."
        }), 400

    username = data.get("username")
    password = data.get("password")

    # Validate credentials
    if (
        not isinstance(username, str)
        or not isinstance(password, str)
        or not username.strip()
        or not password
    ):
        return jsonify({
            "success": False,
            "message": "Username and password are required."
        }), 400

    connection = None

    try:

        # Connect to TiDB Cloud
        connection = get_db_connection()

        # Retrieve matching user
        with connection.cursor() as cursor:

            cursor.execute(
                """
                SELECT
                    user_id,
                    name,
                    username,
                    password,
                    role,
                    is_active
                FROM users
                WHERE username = %s
                LIMIT 1
                """,
                (username.strip(),)
            )

            user = cursor.fetchone()

        # Verify user and password
        if (
            not user
            or not user["is_active"]
            or user["role"] not in ("Owner", "Staff")
            or not check_password_hash(
                user["password"],
                password
            )
        ):
            return jsonify({
                "success": False,
                "message": "Invalid username or password."
            }), 401

        # Create authenticated session
        session.clear()

        session["user_id"] = user["user_id"]
        session["name"] = user["name"]
        session["username"] = user["username"]
        session["role"] = user["role"]

        session.permanent = True

        # Return authenticated user
        return jsonify({
            "success": True,
            "message": "Login successful.",
            "user": {
                "user_id": user["user_id"],
                "name": user["name"],
                "username": user["username"],
                "role": user["role"]
            }
        }), 200

    except Exception:

        app.logger.exception("Login failed")

        return jsonify({
            "success": False,
            "message": "Unable to process login."
        }), 500

    finally:

        if connection is not None:
            connection.close()


# ==========================================
# CURRENT USER API
# GET /api/auth/me
# ==========================================

@app.get("/api/auth/me")
@login_required
def current_user():

    return jsonify({
        "success": True,
        "user": {
            "user_id": session["user_id"],
            "name": session["name"],
            "username": session["username"],
            "role": session["role"]
        }
    })


# ==========================================
# LOGOUT API
# POST /api/auth/logout
# ==========================================

@app.post("/api/auth/logout")
@login_required
def logout():

    session.clear()

    return jsonify({
        "success": True,
        "message": "Logged out successfully."
    })


# ==========================================
# OWNER ACCESS TEST API
# GET /api/test/owner
# ==========================================

@app.get("/api/test/owner")
@owner_required
def owner_test():

    return jsonify({
        "success": True,
        "message": "Owner access granted."
    })


# ==========================================
# RUN FLASK APPLICATION
# ==========================================

if __name__ == "__main__":

    app.run(
        host="127.0.0.1",
        port=5000,
        debug=True
    )
