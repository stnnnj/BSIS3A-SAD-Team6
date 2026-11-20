
import getpass
import requests

# Local Flask backend URL
BASE_URL = "http://127.0.0.1:5000"

# Keep session cookies between requests
client = requests.Session()

print("===================================")
print("CCMC RetailFlow - Authentication Test")
print("===================================")

username = input("Enter username: ").strip()
password = getpass.getpass("Enter password: ")

try:
    # Test 1: Login
    print("\n[TEST 1] Login")

    response = client.post(
        BASE_URL + "/api/auth/login",
        json={
            "username": username,
            "password": password
        },
        timeout=15
    )

    print("HTTP Status:", response.status_code)
    print("Response:", response.json())

    if response.status_code == 200:

        # Test 2: Retrieve authenticated user
        print("\n[TEST 2] Current User")

        me = client.get(
            BASE_URL + "/api/auth/me",
            timeout=15
        )

        print("HTTP Status:", me.status_code)
        print("Response:", me.json())

        # Test 3: Owner-only endpoint
        print("\n[TEST 3] Owner Access")

        owner_response = client.get(
            BASE_URL + "/api/test/owner",
            timeout=15
        )

        print("HTTP Status:", owner_response.status_code)
        print("Response:", owner_response.json())

        # Test 4: Logout
        print("\n[TEST 4] Logout")

        logout = client.post(
            BASE_URL + "/api/auth/logout",
            timeout=15
        )

        print("HTTP Status:", logout.status_code)
        print("Response:", logout.json())

        # Test 5: Verify session ended
        print("\n[TEST 5] Access After Logout")

        after_logout = client.get(
            BASE_URL + "/api/auth/me",
            timeout=15
        )

        print("HTTP Status:", after_logout.status_code)
        print("Response:", after_logout.json())

    else:
        print("\nLogin failed. Remaining tests skipped.")

except requests.RequestException as error:
    print("\nAPI test failed:", type(error).__name__)
    print("Check whether Flask is running.")

except ValueError:
    print("\nInvalid JSON response from Flask.")

finally:
    client.close()
    print("\nAuthentication testing completed.")
