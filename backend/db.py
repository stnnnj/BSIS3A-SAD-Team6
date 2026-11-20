
import os
import ssl
from pathlib import Path

import pymysql
from dotenv import load_dotenv

# Load environment variables from the project root
BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")


def get_db_connection():
    """Create a secure connection to TiDB Cloud."""

    required = [
        "TIDB_HOST",
        "TIDB_PORT",
        "TIDB_USER",
        "TIDB_PASSWORD",
        "TIDB_DATABASE",
        "TIDB_CA_PATH",
    ]

    # Check for missing configuration
    missing = [key for key in required if not os.getenv(key)]

    if missing:
        raise ValueError(
            "Missing database configuration: "
            + ", ".join(missing)
        )

    # Load CA certificate and verify server identity
    ca_path = Path(os.environ["TIDB_CA_PATH"])

    if not ca_path.is_file():
        raise FileNotFoundError(
            f"TiDB CA certificate not found: {ca_path}"
        )

    tls_context = ssl.create_default_context(
        cafile=str(ca_path)
    )

    tls_context.verify_mode = ssl.CERT_REQUIRED
    tls_context.check_hostname = True

    # Connect to TiDB Cloud
    return pymysql.connect(
        host=os.environ["TIDB_HOST"],
        port=int(os.environ["TIDB_PORT"]),
        user=os.environ["TIDB_USER"],
        password=os.environ["TIDB_PASSWORD"],
        database=os.environ["TIDB_DATABASE"],
        charset="utf8mb4",
        connect_timeout=15,
        read_timeout=15,
        write_timeout=15,
        ssl=tls_context,
        cursorclass=pymysql.cursors.DictCursor,
        autocommit=False,
    )
