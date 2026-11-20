
from db import get_db_connection


def test_connection():
    connection = None

    try:
        print("Connecting to CCMC RetailFlow database...")

        connection = get_db_connection()

        with connection.cursor() as cursor:
            cursor.execute("SELECT DATABASE() AS db_name")
            result = cursor.fetchone()

            print("Connected successfully!")
            print("Database:", result["db_name"])

            cursor.execute("SHOW TABLES")
            tables = cursor.fetchall()

            print("\nDatabase tables:")

            for table in tables:
                print("-", list(table.values())[0])

            print("\nTotal tables:", len(tables))

            if len(tables) == 10:
                print("All 10 expected tables are present.")
            else:
                print("WARNING: Expected 10 tables.")

    except Exception as error:
        print("Database connection failed.")
        print("Error:", error)

    finally:
        if connection is not None:
            connection.close()
            print("\nDatabase connection closed.")


if __name__ == "__main__":
    test_connection()
